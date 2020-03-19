
import { NotionAgent, DocumentOperation, SubmitTransactionReturns } from 'notionapi-agent';
import * as url from 'url';
import * as _ from 'lodash';
import { v4 } from 'uuid';
import Telegraf, { TelegramOptions, LaunchPollingOptions, LaunchWebhookOptions, Middleware, ContextMessageUpdate } from 'telegraf';

const { NOTION_TOKEN } = process.env;

const notion = new NotionAgent({
  token: NOTION_TOKEN,
  timezone: 'Asia/Seoul'
});

const dashIDLen = '0eeee000-cccc-bbbb-aaaa-123450000000'.length;
const noDashIDLen = '0eeee000ccccbbbbaaaa123450000000'.length;

function isValidDashID(str: string) {
  if (str.length !== dashIDLen) {
    return false;
  }

  if (str.indexOf('-') === -1) {
    return false;
  }

  return true;
}

function toDashID(str: string) {
  if (isValidDashID(str)) {
    return str;
  }

  const s = str.replace(/-/g, '');

  if (s.length !== noDashIDLen) {
    return str;
  }

  const res = str.substring(0, 8) + '-' + str.substring(8, 12) + '-' + str.substring(12, 16) + '-' + str.substring(16, 20) + '-' + str.substring(20);
  return res
}

function getPageIDFromNotionPageURL(str: string) {
  const parsed = url.parse(str);
  let splitArr = parsed.pathname.split('/');
  splitArr = splitArr.pop().split('-');

  const pageID = splitArr.pop();
  if (pageID && pageID.length === noDashIDLen) {
    return toDashID(pageID);
  } else {
    throw new Error(`Cannot get pageID from ${str}`);
  }
}

async function submitTransaction(operations: DocumentOperation[]): Promise<SubmitTransactionReturns> {
  const result = await notion.submitTransaction(operations);
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result;
}

const NOTION_URL = 'https://www.notion.so/kekefam/';

const URIS = {
  BOOK: NOTION_URL + '4044898e951546df9fadbbba4d98c10f?v=59575ce5af824944a6bc7bd95a14704e',
  DRAFT: NOTION_URL + '0131e73ca2b147cc802692d60fd4a56d?v=4d82e5866a4c426fa788b1b72b46dff6',
  NOTE: NOTION_URL + '80f1b4ba615949faa9625bc42c5fb531?v=c1d00e9c432347c189b0055c24722312',
  PRM: NOTION_URL + '6a3eb7d328bc4e328a9babb598d44d0e?v=6415bd5b087143808dcc7d16a96710ee'
};

const CACHE: {[key: string]: { COLLECTION_ID: string; COLLECTION_VIEW_ID: string }} = {};

async function findCollectionIds(type: string) {
  if (CACHE[type]) return [CACHE[type].COLLECTION_ID, CACHE[type].COLLECTION_VIEW_ID];
  const tempUrl = URIS[type];
  const id = getPageIDFromNotionPageURL(tempUrl);
  const page = await notion.loadPageChunk(id)

  const COLLECTION_ID = _.keys(page.data.recordMap.collection)[0];
  const COLLECTION_VIEW_ID = _.keys(page.data.recordMap.collection_view)[0];
  if (!COLLECTION_ID || !COLLECTION_VIEW_ID) throw new Error('no collection id');
  CACHE[type] = { COLLECTION_ID, COLLECTION_VIEW_ID };
  return [COLLECTION_ID, COLLECTION_VIEW_ID];
}

async function queryCollection(type: string, searchTerm: string) {
  const [collectionId, collectionViewId] = await findCollectionIds(type);

  console.time('queryCollection');
  const response = await notion.queryCollection(collectionId, collectionViewId, []);
  console.timeEnd('queryCollection');

  const { block, collection } = response.data.recordMap;
  const collections = _.values(collection);
  const firstCollection = collections[0].value;
  const schema = firstCollection.schema;
  const keyByProperty = _.transform(schema, (acc, v, k) => acc[v.name] = k, {});
  console.log(keyByProperty);

  const blocks = _.values(block).filter(b => !!b.value);
  const pages = blocks.filter(b => b.value.type === 'page' && !!b.value.properties);
  const results = pages.filter(p => p.value.properties.title[0][0].includes(searchTerm));
  return results.map(r => [r.value.id, r.value.properties.title[0][0], JSON.stringify(r.value.properties[keyByProperty['Read at']])]);
}

async function updateReadAt(id: string) {
  const now = new Date();
  const timezoneShift = new Date(+now + 9 * 60 * 60 * 1000);

  const todayYYYYMMDD = timezoneShift.toISOString().split('T')[0];

  await submitTransaction([{
    id,
    table: 'block',
    path: ['properties', 'fz`,'],
    command: 'set',
    args: [['‣',[['d',{'type':'date','start_date': todayYYYYMMDD}]]]]
  }]);
}

async function updateMetAt(id: string) {
  const now = new Date();
  const timezoneShift = new Date(+now + 9 * 60 * 60 * 1000);

  const todayYYYYMMDD = timezoneShift.toISOString().split('T')[0];

  await submitTransaction([{
    id,
    table: 'block',
    path: ['properties', '87:u'],
    command: 'set',
    args: [['‣',[['d',{'type':'date','start_date': todayYYYYMMDD}]]]]
  }]);
}

async function createNewDraft(pageTitle: string, content?: string) {
  console.log('createNewDraft');

  const draftId = v4();

  const transaction = [{
    id: draftId,
    table: 'block',
    path: [],
    command: 'set',
    args: {
      id: draftId,
      version: 1,
      type: 'page',
      alive: true,
      properties: {
        title: [[pageTitle]]
      },
      parent_id: '02c93613-79e4-4964-9d28-59dbf5c3e3e8',
      parent_table: 'collection',
      created_time: +new Date()
    } as any
  }];

  if (content) {
    const blockId = v4();
    transaction.push({
      id: blockId,
      table: 'block',
      path: [],
      command: 'set',
      args: {
        id: blockId,
        type: 'text',
        alive: true,
        properties: {
          title: [notionNow(), [' ' + content]]
        },
        parent_id: draftId,
        parent_table: 'block',
        created_time: +new Date()
      } as any
    }, {
      id: draftId,
      table: 'block',
      path: ['content'],
      command: 'listAfter',
      args: { id: blockId } as any
    }, {
      id: draftId,
      table: 'block',
      path: ['last_edited_time'],
      command: 'set',
      args: +new Date()
    });
  }

  const result = await submitTransaction(transaction);

  console.log(result);
  return draftId;
}

function pad(value: number) {
  return value.toString().padStart(2, '0');
}

function notionStartDate(now: Date) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function notionStartTime(now: Date) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function notionNow() {
  const now = new Date();
  return [
    "‣",
    [
      [
        "d",
        {
          "type": "datetime",
          "time_zone": "Asia/Seoul",
          "start_date": notionStartDate(now),
          "start_time": notionStartTime(now),
          "date_format": "relative"
        }
      ]
    ]
  ];
}

async function memo(text: string) {
  const SEEDBED_MEMO = '34b815a1-89e7-4fb0-9e24-89d01a62a6d7';
  const id = v4();

  const args = {
    id,
    type: 'text',
    alive: true,
    properties: {
      title: [notionNow(), [' ' + text]]
    },
    parent_id: SEEDBED_MEMO,
    parent_table: 'block',
    created_time: +new Date()
  };

  await submitTransaction([{
    id,
    table: 'block',
    path: [],
    command: 'set',
    args: args as any
  }, {
    id,
    table: 'block',
    path: [],
    command: 'update',
    args: { type: 'bulleted_list' } as any
  }, {
    id: SEEDBED_MEMO,
    table: 'block',
    path: ['content'],
    command: 'listAfter',
    args: {
      id
    } as any
  }, {
    id: SEEDBED_MEMO,
    table: 'block',
    path: ['last_edited_time'],
    command: 'set',
    args: +new Date() as any
  }]);

  return SEEDBED_MEMO;
}

function blockIdToNotionUri(id: string) {
  return NOTION_URL + id.replace(/-/g, '');
}

function sliceResults(results: string[], ends: number = -20) {
  return results.slice(ends).map((r, i, sliced) => {
    if (results.length > sliced.length && i === sliced.length - 1) {
      return `... 외 ${results.length - sliced.length}`;
    }
    return r;
  });
}

export function errorCatcher(middleware: Middleware<ContextMessageUpdate>): Middleware<ContextMessageUpdate> {
  return async function (ctx: ContextMessageUpdate) {
    try {
      return await middleware(ctx);
    } catch (e) {
      await ctx.reply(e.message);
    }
  }
}

function idToNotionUri(id: string) {
  const uri = id.replace(/-/g, '');
  return NOTION_URL + uri;
}

export const COMMANDS: [string, Middleware<ContextMessageUpdate>][] = [
  ['book', async ctx => {
    const searchTerm = ctx.update.message.text.split(' ').slice(1).join(' ');
    await ctx.reply('wait a sec');
    const results = await queryCollection('BOOK', searchTerm);
    if (results.length === 0) return ctx.reply('그런책 없음: ' + searchTerm);

    return ctx.reply(sliceResults(results.map(r => `• [${r[1]}](${blockIdToNotionUri(r[0])})`)).join('\n'), { parse_mode: 'Markdown' });
  }],
  ['read', async ctx => {
    const searchTerm = ctx.update.message.text.split(' ').slice(1).join(' ');
    await ctx.reply('wait a sec');
    const results = await queryCollection('BOOK', searchTerm);
    if (results.length === 0) return ctx.reply('그런책 없음: ' + searchTerm);
    if (results.length > 1) return ctx.reply('다음 중 어느 책인가요? ' + sliceResults(results.map(r => r[1])).join(', '));

    await updateReadAt(results[0][0]);
    return ctx.reply(`[${results[0][1]}](${blockIdToNotionUri(results[0][0])}) 읽은 시간 업데이트 했습니다`, { parse_mode: 'Markdown' });
  }],
  ['draft', async ctx => {
    const searchTerm = ctx.update.message.text.split(' ').slice(1).join(' ');
    await ctx.reply('wait a sec');

    const results = await queryCollection('DRAFT', searchTerm);
    if (results.length === 0) return ctx.reply('그런 글감 없음: ' + searchTerm);
    return ctx.reply(sliceResults(results.map(r => `• [${r[1]}](${blockIdToNotionUri(r[0])})`)).join('\n'), { parse_mode: 'Markdown' });
  }],
  ['newdraft', async ctx => {
    const text = ctx.update.message.text;
    const [, _cmd, title, content] = text.match(/\/([^ ]+) ([^-]+)[ ]?-[ ]?(.*)/);
    const draftId = await createNewDraft(title.trim(), content);
    return ctx.reply(`[${title.trim()}](${idToNotionUri(draftId)}) 문서를 만들었습니다`, { parse_mode: 'Markdown' });
  }], ['people', async ctx => {
    const searchTerm = ctx.update.message.text.split(' ').slice(1).join(' ');
    await ctx.reply('wait a sec');

    const results = await queryCollection('PRM', searchTerm);
    if (results.length === 0) return ctx.reply('그런 사람 없음: ' + searchTerm);
    return ctx.reply(sliceResults(results.map(r => `• [${r[1]}](${blockIdToNotionUri(r[0])})`)).join('\n'), { parse_mode: 'Markdown' });
  }], ['met', async ctx => {
    const searchTerm = ctx.update.message.text.split(' ').slice(1).join(' ');
    await ctx.reply('wait a sec');
    const results = await queryCollection('PRM', searchTerm);
    if (results.length === 0) return ctx.reply('그런 사람 없음: ' + searchTerm);
    if (results.length > 1) return ctx.reply('다음 중 누구인가요? ' + sliceResults(results.map(r => r[1])).join(', '));

    await updateMetAt(results[0][0]);
    return ctx.reply(`[${results[0][1]}](${blockIdToNotionUri(results[0][0])})님과 만난 시간을 업데이트 했습니다`, { parse_mode: 'Markdown' });
  }]
];

export async function onText(ctx: ContextMessageUpdate) {
    const blockId = await memo(ctx.update.message.text);
    return ctx.reply(`[Seed Bed/Memo](${idToNotionUri(blockId)})에 추가했습니다`, { parse_mode: 'Markdown' });
}

export async function onStart(ctx: ContextMessageUpdate) {
    return ctx.reply('Welcome');
}
