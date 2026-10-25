import { readFile, mkdir } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import process from 'node:process';
import { chromium } from '@playwright/test';
const html = await readFile(process.env.UNO_CLIENT_PATH || new URL('../game-packages/uno/client.html', import.meta.url), 'utf8');
const output = new URL('../dist/uno-check/', import.meta.url);
await mkdir(output, { recursive: true });
const baseView = {
  players: [{seatId:'a',count:2},{seatId:'b',count:7},{seatId:'c',count:7},{seatId:'d',count:7}],
  you:'a', hand:[{id:'red.2.0',color:'red',value:'2'},{id:'wild.wild.0',color:'wild',value:'wild'}],
  top:{id:'red.5.0',color:'red',value:'5'},color:'red',direction:1,currentSeat:'a',deckCount:79,
  drawn:null,winners:[],last:'座位 1 先出牌',actions:[
    {type:'play',cardId:'red.2.0',color:null,uno:true},
    ...['red','yellow','green','blue'].map(color=>({type:'play',cardId:'wild.wild.0',color,uno:true})),{type:'draw'}]
};
const browser = await chromium.launch();
try {
  for (const [name, viewport] of [['desktop',{width:1440,height:900}],['laptop',{width:1280,height:800}],['mobile',{width:390,height:844}],['narrow',{width:320,height:740}]]) {
    const page = await browser.newPage({viewport});
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://uno.test/**', async route=>{
      if (route.request().url().endsWith('/desktop')) {
        await route.fulfill({contentType:'text/html',body:html,headers:{'content-security-policy':"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'"}});
      } else {
        await route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#183e45"><iframe title="UNO" sandbox="allow-scripts" src="/desktop" style="width:100%;height:800px;border:0"></iframe><div style="height:300px"></div><script>
        window.gameView=${JSON.stringify(baseView)}; window.actions=[];
        window.publish=function(busy=false){document.querySelector('iframe').contentWindow.postMessage({type:'boardgame:view',view:window.gameView,busy,events:[]},'*')};
        addEventListener('message',event=>{if(event.source!==document.querySelector('iframe').contentWindow)return;if(event.data.type==='boardgame:ready')publish();if(event.data.type==='boardgame:resize')document.querySelector('iframe').style.height=event.data.height+'px';if(event.data.type==='boardgame:action'){actions.push(event.data.action);publish(true)}});
        </script></body></html>`});
      }
    });
    await page.goto('http://uno.test/');
    const frame = page.frameLocator('iframe');
    await frame.getByText('轮到你了',{exact:true}).waitFor();
    assert.equal(await frame.locator('#players .player').count(),4);
    assert.equal(await frame.getByRole('button',{name:'红色 2',exact:true}).isEnabled(),true);
    await frame.getByLabel('出牌时喊 UNO').check();
    await frame.getByRole('button',{name:'万能色 ★',exact:true}).click();
    await frame.getByRole('dialog').waitFor();
    await page.evaluate(()=>globalThis.publish(false));
    assert.equal(await frame.getByRole('dialog').isVisible(),true,'an identical idle snapshot must preserve the color picker');
    assert.equal(await frame.getByLabel('出牌时喊 UNO').isChecked(),true);
    await frame.getByRole('button',{name:'取消出牌'}).press('Escape');
    assert.equal(await frame.getByRole('button',{name:'万能色 ★',exact:true}).evaluate(button=>button===globalThis.document.activeElement),true);
    assert.equal((await page.evaluate(()=>globalThis.actions)).length,0);
    await frame.getByRole('button',{name:'万能色 ★',exact:true}).click();
    await frame.getByRole('button',{name:'蓝',exact:true}).click();
    await page.waitForFunction(()=>globalThis.actions.length===1);
    assert.deepEqual(await page.evaluate(()=>globalThis.actions[0]),{type:'play',cardId:'wild.wild.0',color:'blue',uno:true});
    assert.equal(await frame.getByRole('button',{name:'摸一张'}).isDisabled(),true);
    // A failed transport leaves the same authoritative View but busy clears; retry unlocks.
    await page.evaluate(()=>globalThis.publish(false));
    await frame.getByText('轮到你了',{exact:true}).waitFor();
    await frame.getByRole('button',{name:'红色 2',exact:true}).click();
    await page.waitForFunction(()=>globalThis.actions.length===2);
    assert.equal((await page.evaluate(()=>globalThis.actions[1])).cardId,'red.2.0');
    await page.evaluate(()=>globalThis.publish(false));
    await frame.getByRole('button',{name:'摸一张'}).click();
    await page.waitForFunction(()=>globalThis.actions.length===3);
    assert.deepEqual(await page.evaluate(()=>globalThis.actions[2]),{type:'draw'});
    const drawnView = {...baseView,drawn:'red.2.0',actions:[baseView.actions[0],{type:'pass'}]};
    await page.evaluate(view=>{globalThis.gameView=view;globalThis.publish(false);},drawnView);
    await frame.getByRole('button',{name:'保留并结束回合'}).click();
    await page.waitForFunction(()=>globalThis.actions.length===4);
    assert.deepEqual(await page.evaluate(()=>globalThis.actions[3]),{type:'pass'});
    await page.evaluate(view=>{globalThis.gameView=view;globalThis.publish(false);},baseView);
    await frame.getByText('轮到你了',{exact:true}).waitFor();
    await page.screenshot({path:fileURLToPath(new URL(`${name}.png`,output)),fullPage:true});
    const child = page.frames().find(item=>item.url().endsWith('/desktop'));
    assert.equal(await child.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth),true);
    assert.equal(await child.evaluate(()=>{try{return globalThis.parent.document.cookie;}catch{return 'blocked';}}),'blocked');
    const waiting = {...baseView,currentSeat:'b',actions:[]};
    await page.evaluate(view=>{globalThis.gameView=view;globalThis.publish(false);},waiting);
    await frame.getByText('等待座位 2出牌',{exact:true}).waitFor();
    assert.equal(await frame.locator('#hand button:enabled').count(),0);
    // A long hand scrolls within its own strip rather than widening the whole page.
    const many = {...baseView,hand:Array.from({length:35},(_,i)=>({id:`blue.${i}`,color:'blue',value:String(i%10)})),actions:[{type:'draw'}]};
    await page.evaluate(view=>{globalThis.gameView=view;globalThis.publish(false);},many);
    await page.screenshot({path:fileURLToPath(new URL(`${name}-long-hand.png`,output)),fullPage:true});
    assert.equal(await child.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth),true);
    const longWild = {...many,hand:[...many.hand,baseView.hand[1]],actions:baseView.actions.filter(action=>action.type==='play'&&action.cardId==='wild.wild.0')};
    await page.evaluate(view=>{globalThis.gameView=view;globalThis.publish(false);globalThis.scrollTo(0,globalThis.document.body.scrollHeight);},longWild);
    await frame.getByRole('button',{name:'万能色 ★',exact:true}).click();
    await frame.getByRole('button',{name:'红',exact:true}).click({timeout:5000});
    await page.waitForFunction(()=>globalThis.actions.length===5);
    assert.deepEqual(await page.evaluate(()=>globalThis.actions[4]),{type:'play',cardId:'wild.wild.0',color:'red',uno:false});
    await page.evaluate(()=>globalThis.publish(false));
    await frame.getByRole('button',{name:'按颜色整理',exact:true}).click();
    assert.equal(await frame.getByRole('button',{name:'恢复摸牌顺序',exact:true}).getAttribute('aria-pressed'),'true');
    await frame.getByRole('button',{name:'恢复摸牌顺序',exact:true}).click();
    // The same client renders each edition only from the player's public view.
    const mercy = {...baseView,edition:'no-mercy',phase:'play',pendingDraw:12,lastDraw:6,
      players:[{seatId:'a',count:2},{seatId:'b',count:0,eliminated:true},{seatId:'c',count:20},{seatId:'d',count:7}],actions:[{type:'draw'}]};
    await page.evaluate(view=>{globalThis.gameView=view;globalThis.publish(false);},mercy);
    await frame.getByRole('button',{name:'承受 12 张',exact:true}).click();
    await page.waitForFunction(()=>globalThis.actions.length===6);
    assert.deepEqual(await page.evaluate(()=>globalThis.actions[5]),{type:'draw'});
    const swap = {...mercy,phase:'swap',pendingDraw:0,actions:[{type:'swap',target:'c'}]};
    await page.evaluate(view=>{globalThis.gameView=view;globalThis.publish(false);},swap);
    await frame.getByRole('button',{name:'与座位 3交换 · 20 张',exact:true}).click();
    await page.waitForFunction(()=>globalThis.actions.length===7);
    assert.deepEqual(await page.evaluate(()=>globalThis.actions[6]),{type:'swap',target:'c'});
    const roulette = {...mercy,phase:'roulette',pendingDraw:0,actions:[{type:'roulette',color:'green'}]};
    await page.evaluate(view=>{globalThis.gameView=view;globalThis.publish(false);},roulette);
    await frame.getByRole('button',{name:'轮盘选绿色',exact:true}).click();
    await page.waitForFunction(()=>globalThis.actions.length===8);
    assert.deepEqual(await page.evaluate(()=>globalThis.actions[7]),{type:'roulette',color:'green'});
    const catchView = {...mercy,currentSeat:'d',pendingDraw:0,actions:[{type:'catchUno',target:'d'}]};
    await page.evaluate(view=>{globalThis.gameView=view;globalThis.publish(false);},catchView);
    await frame.getByRole('button',{name:'抓座位 4漏喊 UNO',exact:true}).click();
    await page.waitForFunction(()=>globalThis.actions.length===9);
    assert.deepEqual(await page.evaluate(()=>globalThis.actions[8]),{type:'catchUno',target:'d'});
    await page.evaluate(view=>{globalThis.gameView=view;globalThis.publish(false);},mercy);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.screenshot({path:fileURLToPath(new URL(`${name}-no-mercy.png`,output)),fullPage:true});
    assert.equal(await child.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth),true);
    const ended = {...baseView,winners:['a'],actions:[]};
    await page.evaluate(view=>{globalThis.gameView=view;globalThis.publish(false);},ended);
    await frame.getByText('本局结束 · 座位 1获胜',{exact:true}).waitFor();
    assert.equal(await frame.locator('#draw').isVisible(),false);
    assert.deepEqual(errors,[]);
    await page.reload();
    await frame.getByText('轮到你了',{exact:true}).waitFor();
    await page.close();
    console.log(`${name}: UNO iframe controls, UNO/color selection, transport retry, draw/pass, privacy, refresh and overflow passed`);
  }
} finally { await browser.close(); }
