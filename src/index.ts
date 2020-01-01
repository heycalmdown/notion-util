import { NotionAgent } from 'notionapi-agent';
import * as url from 'url';
import * as _ from 'lodash';
import { v4 } from 'uuid';
import Telegraf from 'telegraf';

const { NOTION_TOKEN, TELEGRAM_TOKEN } = process.env;

const telegram = new Telegraf(TELEGRAM_TOKEN);
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

const CACHE = {
  COLLECTION_ID: 'e6503e49-274b-468d-9038-681263f9b659',
  COLLECTION_VIEW_ID: '59575ce5-af82-4944-a6bc-7bd95a14704e'
};

async function findCollectionIds() {
  if (CACHE.COLLECTION_ID && CACHE.COLLECTION_VIEW_ID) return [CACHE.COLLECTION_ID, CACHE.COLLECTION_VIEW_ID];
  const tempUrl = 'https://www.notion.so/kekefam/4044898e951546df9fadbbba4d98c10f?v=59575ce5af824944a6bc7bd95a14704e';
  const id = getPageIDFromNotionPageURL(tempUrl);
  const page = await notion.loadPageChunk(id)

  const collectionId = _.keys(page.data.recordMap.collection)[0];
  const collectionViewId = _.keys(page.data.recordMap.collection_view)[0];
  return [collectionId, collectionViewId];
}

async function findNotesIds() {
  const tempUrl = 'https://www.notion.so/kekefam/80f1b4ba615949faa9625bc42c5fb531?v=c1d00e9c432347c189b0055c24722312';
  const id = getPageIDFromNotionPageURL(tempUrl);
  const page = await notion.loadPageChunk(id)

  const collectionId = _.keys(page.data.recordMap.collection)[0];
  const collectionViewId = _.keys(page.data.recordMap.collection_view)[0];
  return [collectionId, collectionViewId];
}

async function queryBooks(searchTerm: string) {
  const [collectionId, collectionViewId] = await findCollectionIds();

  console.log(searchTerm);

  console.time('queryCollection');
  const response = await notion.queryCollection(collectionId, collectionViewId, []);
  console.timeEnd('queryCollection');

  const { block, collection } = response.data.recordMap;
  const collections = _.values(collection);
  const firstCollection = collections[0].value;
  const schema = firstCollection.schema;
  const keyByProperty = _.transform(schema, (acc, v, k) => acc[v.name] = k, {});
  console.log(keyByProperty);

  const blocks = _.values(block);
  const pages = blocks.filter(b => b.value.type === 'page');
  const results = pages.filter(p => p.value.properties.title[0][0].includes(searchTerm)).slice(-5);
  return results.map(r => [r.value.id, r.value.properties.title[0][0], JSON.stringify(r.value.properties[keyByProperty['Read at']])]);
}

async function queryNotes() {
  return findNotesIds();
}

async function updateReadAt(id: string) {
  const now = new Date();
  const timezoneShift = new Date(+now + 9 * 60 * 60 * 1000);

  const todayYYYYMMDD = timezoneShift.toISOString().split('T')[0];

  await notion.submitTransaction([{
    id,
    table: 'block',
    path: ['properties', 'fz`,'],
    command: 'set',
    args: [['‣',[['d',{'type':'date','start_date': todayYYYYMMDD}]]]]
  }]);
}

async function createNewDay(pageTitle: string) {
  console.log('createNewDay');

  const id = v4();

  const args = {
    id,
    version: 1,
    type: 'page',
    alive: true,
    properties: {
      title: [[pageTitle]]
    },
    parent_id: '54cbdff5-ae05-439f-a3cd-e8513a449238',
    parent_table: 'collection',
    created_time: +new Date()
  };

  const result = await notion.submitTransaction([{
    id,
    table: 'block',
    path: [],
    command: 'set',
    args: args as any
  }]);

  console.log(result);
}

async function addNewMemo(pageId: string, text: string) {
  const id = v4();

  const args = {
    id,
    type: 'text',
    alive: true,
    properties: {
      title: [[text]]
    },
    parent_id: '678bf8f7-dbd6-4f11-86a3-da4aefd61e0a',
    parent_table: 'block',
    created_time: +new Date()
  };

  const result = await notion.submitTransaction([{
    id,
    table: 'block',
    path: [],
    command: 'set',
    args: args as any
  }, {
    id: pageId,
    table: 'block',
    path: ['content'],
    command: 'listAfter',
    args: {
      id
    } as any
  }, {
    id: pageId,
    table: 'block',
    path: ['last_edited_time'],
    command: 'set',
    args: +new Date()
  }]);

  console.log(result);
}

async function getDailySeedBed() {
  const [collectionId, collectionViewId] = await queryNotes();
  console.time('queryCollection');
  const response = await notion.queryCollection(collectionId, collectionViewId, []);
  console.timeEnd('queryCollection');

  const { block } = response.data.recordMap;
  return block;
}

async function getToday(today: string) {
  console.time('getDailySeedBed');
  const block = await getDailySeedBed();
  console.timeEnd('getDailySeedBed');

  const blocks = _.values(block);
  const pages = blocks.filter(b => b.value.type === 'page');
  const results = pages.filter(p => p.value.properties.title[0][0] === today);
  return results[0];
}

async function ensureToday() {
  const now = new Date();
  const timezoneShift = new Date(+now + 9 * 60 * 60 * 1000);

  const todayYYYYMMDD = timezoneShift.toISOString().split('T')[0];

  const result = await getToday(todayYYYYMMDD);
  if (result) return result;

  await createNewDay(todayYYYYMMDD);

  return getToday(todayYYYYMMDD);
}

async function memo(text: string) {
  const today = await ensureToday();
  console.time('addNewMemo');
  await addNewMemo(today.value.id, text);
  console.timeEnd('addNewMemo');
}

telegram.start((ctx) => ctx.reply('Welcome'));
telegram.help((ctx) => ctx.reply('Send me a sticker'));
telegram.command('book', async ctx => {
  const searchTerm = ctx.update.message.text.split(' ').slice(1).join(' ');
  await ctx.reply('wait a sec');
  const results = await queryBooks(searchTerm);
  if (results.length === 0) return ctx.reply('그런책 없음: ' + searchTerm);
  if (results.length > 1) return ctx.reply('다음 중 어느 책인가요? ' + results.map(r => r[1]).join(', '));

  await updateReadAt(results[0][0]);
  await ctx.reply('다음 책의 읽은 시간 업데이트 했습니다: ' + results[0][1]);
});
telegram.command('memo', async ctx => {
  await memo(ctx.update.message.text.split(' ').slice(1).join(' '));
  await ctx.reply('메모 추가 완료');
});

telegram.launch();
