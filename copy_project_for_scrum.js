const {
  graphql
} = require('@octokit/graphql');

const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `Token hogehoge`, // GitHubのトークンを記載する
  },
});

const currentProjectNumber = process.argv[2] // 実行する際に引数を渡します。 コピーしたいプロジェクト番号を入力するようにする
// 消費したSPを計算したいGitHubアカウントを記載する
let memberDigestSpResult = {
  'y-mitsuyoshi': 0,
}

// 現在保持しているSPを計算したいGitHubアカウントを記載する
let memberPossessionSpResult = {
  'y-mitsuyoshi': 0,
}
var after = null;
var items = [];

// 既存のprojectを取得
while (true) {
  var currentProjectQuery = `
  query {
      organization(login: "y-mitsuyoshi"){ // organization名をloginに入れるようにする
      id
      name
      description
      url
      projectV2(number: ${currentProjectNumber}) {
        id
        title
        items(first: 100, after: "${after}") {
          totalCount
          pageInfo {
            endCursor
            hasNextPage
            hasPreviousPage
            startCursor
          }
          nodes {
            id
            type
            status: fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                  id
                  name
                  optionId
              }
            }
            content {
              ... on Issue {
                id
                url
                title
                closed
                labels(first: 100) {
                  nodes {
                    name
                  }
                }
                assignees(first: 100){
                  nodes {
                    id
                    url
                  }
                }
              }
            }
          }
        }
      }
      }
  }
  `;
  var currentProject = await graphqlWithAuth(currentProjectQuery);
  after = currentProject.organization.projectV2.items.pageInfo.endCursor;
  items = items.concat(currentProject.organization.projectV2.items.nodes);
  if (!currentProject.organization.projectV2.items.pageInfo.hasNextPage) {
    break;
  }
}

// 消化SPを計算
try {
  for (let memberName in memberDigestSpResult) {
    sp = 0
    items.forEach(item => {
      if (item.status.name === 'Done') {
        if (item['type'] !== 'ISSUE') {
          return;
        }
        item.content.assignees.nodes.forEach(assignee => {
          if (assignee['url'] == 'https://github.com/' + memberName) {
            item.content.labels.nodes.forEach(label => {
              if (label.name.includes('SP-')) {
                sp += Number(label.name.replace('SP-', ''))
              }
            })
          }
        });
      }
    });
    memberDigestSpResult[memberName] = sp
  }
} catch (err) {
  console.error(err.message);
}

// 保有SPを計算
try {
  for (let memberName in memberPossessionSpResult) {
    sp = 0
    items.forEach(item => {
      if (item['type'] !== 'ISSUE') {
        return;
      }
      if (item.status.name !== 'Done') {
        item.content.assignees.nodes.forEach(assignee => {
          if (assignee['url'] == 'https://github.com/' + memberName) {
            item.content.labels.nodes.forEach(label => {
              if (label.name.includes('SP-')) {
                sp += Number(label.name.replace('SP-', ''))
              }
            })
          }
        });
      }
    });
    memberPossessionSpResult[memberName] = sp
  }
} catch (err) {
  console.error(err.message);
}

// 新規のprojectを作成する
const ownerId = currentProject.organization.id
const currentProjectId = currentProject.organization.projectV2.id
const currentProjectTitle = currentProject.organization.projectV2.title
const dateString = currentProjectTitle.split("_")[1];
const currentDate = new Date(dateString);
const twoWeeksLaterDate = new Date(currentDate.getTime() + 14 * 24 * 60 * 60 * 1000);
const year = twoWeeksLaterDate.getFullYear();
const month = (twoWeeksLaterDate.getMonth() + 1).toString().padStart(2, "0");
const day = twoWeeksLaterDate.getDate().toString().padStart(2, "0");
const newProjectTitle = "スクラム_" + year + "/" + month + "/" + day;
const copyProjectMutation = `
mutation{
    copyProjectV2(input: {
        includeDraftIssues: true,
        ownerId: "${ownerId}",
        projectId: "${currentProjectId}",
        title: "${newProjectTitle}"
    }) {
        projectV2 {
            id
            title
            fields(first: 10) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                }
                ... on ProjectV2IterationField {
                  id
                  name
                  configuration {
                    iterations {
                      startDate
                      id
                    }
                  }
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
        }
    }
}
`;
const newProject = await graphqlWithAuth(copyProjectMutation);

// 新規のprojectにclosed以外のissueを移し替える。
// 新規のprojectのステータスを移動する
const newProjectId = newProject.copyProjectV2.projectV2.id
const newProjectStatusFieldId = newProject.copyProjectV2.projectV2.fields.nodes[2].id
async function addIsuueInNewProject(contentId) {
  const addIsuueInNewProjectMutation = `
    mutation addProjectV2ItemById{
      addProjectV2ItemById(
        input:{
            contentId: "${contentId}",
            projectId: "${newProjectId}"
        }
      ) 
      {
        item {
          id
        }
      }
    }
  `;
  var res = await graphqlWithAuth(addIsuueInNewProjectMutation);
  return res;
}
async function changeStatusCopyedIssue(itemId, singleSelectOptionId) {
  const changeStatusCopyedIssueMutation = `
      mutation updateProjectV2ItemFieldValue{
      updateProjectV2ItemFieldValue(
          input:{
              itemId: "${itemId}",
              fieldId: "${newProjectStatusFieldId}",
              projectId: "${newProjectId}",
              value: {
                  singleSelectOptionId: "${singleSelectOptionId}"
              }
          }
      ) 
      {
        projectV2Item {
            id
          }
        }
    }
  `;
  var res = await graphqlWithAuth(changeStatusCopyedIssueMutation);
  return res;
}
for (var item of items) {
  if (item['type'] !== 'ISSUE') {
    continue;
  }
  if (item.status.name !== 'Done') {
    var copyedIssue = await addIsuueInNewProject(item.content.id);
    var singleSelectOptionId = null;
    for (var status of newProject.copyProjectV2.projectV2.fields.nodes[2].options) {
      if (item.status.name === status.name) {
        singleSelectOptionId = status.id;
        break;
      }
    }
    await changeStatusCopyedIssue(copyedIssue.addProjectV2ItemById.item.id, singleSelectOptionId);
  }
}

// 既存のprojectのclosed以外のissueを削除
async function removeUnclosedIssueInCurrentProject(itemId) {
  const removeUnclosedIssueInCurrentProject = `
    mutation deleteProjectV2Item{
      deleteProjectV2Item(
        input:{
          itemId: "${itemId}",
          projectId: "${currentProjectId}"
        }
      ) 
      {
        deletedItemId
      }
    }
  `;
  var res = await graphqlWithAuth(removeUnclosedIssueInCurrentProject);
  return res;
}
for (var item of items) {
  if (item.status.name !== 'Done') {
    await removeUnclosedIssueInCurrentProject(item.id);
  }
}

// 既存のprojectをcloseする
const closeCurrentProject = `
mutation updateProjectV2{
  updateProjectV2(
    input:{
        projectId: "${currentProjectId}"
        closed: true
    }
  ) 
  {
    projectV2 {
      number
    }
  }
}
`;

var res = await graphqlWithAuth(closeCurrentProject);

// 消化SP
memberDigestSpResult
// 保持SP
memberPossessionSpResult
