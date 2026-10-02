/*
 * Smoke test appky – Chromium + Playwright, Supabase je kompletně mockovaný.
 *
 *   node test/smoke.js
 *
 * Nepotřebuje síť ani živou databázi. Ověřuje přihlašovací hradbu,
 * escapování výstupu, CRUD peněženek a model deníku (skutečnost + plán).
 */
const {chromium}=require('playwright');

const SB='https://fcycbzbzhuslmkfbgryb.supabase.co';
const CHROME=process.env.CHROME_PATH||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const APP='file://'+require('path').resolve(__dirname,'..','index.html');
const M=new Date().toISOString().slice(0,7);
const d=n=>`${M}-${String(n).padStart(2,'0')}`;
// jiný měsíc, ale vždy ve stejném roce – v prosinci se vrací na leden
const M2=(()=>{const y=+M.slice(0,4),m=+M.slice(5,7);return `${y}-${String(m===12?1:m+1).padStart(2,'0')}`;})();
const d2=n=>`${M2}-${String(n).padStart(2,'0')}`;

// Data schválně obsahují HTML, uvozovky a nesmyslnou barvu – nic z toho
// se nesmí dostat do DOM jako kód.
const DB={
  osnova:[
    {id:1,nazev:'Mzda <script>alert(1)</script>',parent_id:null,typ:'prijem',kod:'1',poradi:0},
    {id:11,nazev:'Peta',parent_id:1,typ:null,kod:'1.1',poradi:0},
    {id:9,nazev:'Jídlo & <b>pití</b>',parent_id:null,typ:'vydaj',kod:'9',poradi:1},
    {id:91,nazev:'Albert "levně"',parent_id:9,typ:null,kod:'9.1',poradi:0},
    {id:10,nazev:'Ostatni',parent_id:null,typ:'vydaj',kod:'10',poradi:2},
  ],
  penezenky:[{id:1,nazev:'Ucet <img src=x onerror=alert(2)>',pocatecni_zustatek:'10000.00',
              barva:'red;background:url(javascript:alert(3))'}],
  zaznamy:[
    {id:100,datum:d(3),castka:'90000.00',typ:'prijem',typ_polozky:'skutecnost',kategorie_id:11,kde:'Demos',poznamka:null,penezenka_id:1},
    {id:101,datum:d(5),castka:'1200.00',typ:'vydaj',typ_polozky:'skutecnost',kategorie_id:91,kde:'Albert & <i>spol</i>',poznamka:'pozn "x" <hr>',penezenka_id:1},
    {id:102,datum:d(6),castka:'800.00',typ:'vydaj',typ_polozky:'skutecnost',kategorie_id:10,kde:'Action',poznamka:null,penezenka_id:1},
    {id:200,datum:d(15),castka:'88000.00',typ:'prijem',typ_polozky:'plan',kategorie_id:11,kde:'Demos',poznamka:'Plat',penezenka_id:1},
    {id:201,datum:d(20),castka:'5000.00',typ:'vydaj',typ_polozky:'plan',kategorie_id:91,kde:'NA',poznamka:null,penezenka_id:1},
    {id:202,datum:d(25),castka:'3300.00',typ:'vydaj',typ_polozky:'plan',kategorie_id:null,kde:'Colliery',poznamka:'Bez kategorie',penezenka_id:1},
    // Jiný měsíc téhož roku, kvůli matici v záložce Rok: skutečnost přetáhla
    // plán, takže musí zčervenat. Bez peněženky, ať to nerozhodí zůstatek,
    // a mimo aktuální měsíc, ať to nerozhodí oddíly počítané po měsíci.
    {id:103,datum:d2(10),castka:'4000.00',typ:'vydaj',typ_polozky:'skutecnost',kategorie_id:10,kde:'Přetah',poznamka:null,penezenka_id:null},
    {id:203,datum:d2(12),castka:'1000.00',typ:'vydaj',typ_polozky:'plan',kategorie_id:10,kde:'Přetah plán',poznamka:null,penezenka_id:null},
  ],
};

// Strop PostgRESTu na počet řádků v jedné odpovědi (u Supabase bývá 1000).
const MAX_ROWS=1000;

const calls=[], fails=[];
function check(name,ok,detail){
  if(!ok)fails.push(name);
  console.log((ok?'  ok   ':'  FAIL ')+name+((detail&&!ok)?('  << '+detail):''));
}
// toLocaleString('cs-CZ') odděluje tisíce pevnou mezerou
const txt=s=>String(s).replace(/[  ]/g,' ');

(async()=>{
const b=await chromium.launch({executablePath:CHROME});
const ctx=await b.newContext();
const pg=await ctx.newPage();
const errors=[];
pg.on('pageerror',e=>errors.push('pageerror: '+e.message));
pg.on('dialog',async x=>{errors.push('DIALOG (XSS!): '+x.message);await x.dismiss();});
pg.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});

await pg.route(SB+'/**',async route=>{
  const req=route.request(), url=req.url(), method=req.method();
  calls.push({method,url:url.replace(SB,''),prefer:req.headers()['prefer']||null,
              auth:(req.headers()['authorization']||'').slice(0,20),body:req.postData()});
  if(url.includes('/auth/v1/token')){
    const body=JSON.parse(req.postData()||'{}');
    if(url.includes('grant_type=password')&&body.password!=='spravne')
      return route.fulfill({status:400,contentType:'application/json',
        body:JSON.stringify({error_description:'Invalid login credentials'})});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(
      {access_token:'TOK.'+Date.now(),refresh_token:'REF',expires_in:3600,user:{email:'test@domacnost.cz'}})});
  }
  if(url.includes('/auth/v1/'))return route.fulfill({status:204,body:''});
  const t=url.replace(SB+'/rest/v1/','').split('?')[0];
  if(method==='GET'){
    // PostgREST vrací nejvýš `db-max-rows` řádků a nijak to nehlásí. Mock to
    // musí dělat taky, jinak by test neodhalil, že appka nestránkuje a tiše
    // pracuje jen s první tisícovkou záznamů.
    const rows=DB[t]||[];
    const q=new URL(url).searchParams;
    const od=parseInt(q.get('offset')||'0',10);
    const chce=parseInt(q.get('limit')||String(MAX_ROWS),10);
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify(rows.slice(od,od+Math.min(chce,MAX_ROWS)))});
  }
  if(method==='POST'){const r=JSON.parse(req.postData());const a=Array.isArray(r)?r:[r];
    return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify(a.map((x,i)=>({id:900+i,...x})))});}
  if(method==='PATCH')return route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify([{id:1,...JSON.parse(req.postData())}])});
  return route.fulfill({status:204,body:''});
});

await pg.goto(APP);

console.log('\n== 1. přihlašovací hradba ==');
check('login je vidět',await pg.isVisible('#auth-screen'));
check('appka je skrytá',!(await pg.isVisible('main')));
check('před loginem žádné volání na data',!calls.some(c=>c.url.includes('/rest/v1/')));

console.log('\n== 2. špatné heslo ==');
await pg.fill('#auth-email','test@domacnost.cz'); await pg.fill('#auth-pass','blbe');
await pg.click('#btn-login'); await pg.waitForTimeout(400);
check('chyba se zobrazí',await pg.isVisible('#auth-err'));
check('chyba je česky',(await pg.textContent('#auth-err')).includes('Nesprávný'));
check('pořád zamčeno',await pg.isVisible('#auth-screen'));
check('tlačítko znovu aktivní',!(await pg.isDisabled('#btn-login')));

console.log('\n== 3. správné heslo ==');
await pg.fill('#auth-pass','spravne'); await pg.click('#btn-login');
await pg.waitForSelector('main',{state:'visible',timeout:5000}); await pg.waitForTimeout(500);
check('appka odemčena',await pg.isVisible('main'));
check('loading zmizel',!(await pg.isVisible('#loading')));
check('e-mail v hlavičce',(await pg.textContent('#user-email'))==='test@domacnost.cz');
check('heslo vymazáno z pole',(await pg.inputValue('#auth-pass'))==='');
const dc=calls.filter(c=>c.url.includes('/rest/v1/'));
check('data se tahají s user tokenem',dc.length>0&&dc.every(c=>c.auth.startsWith('Bearer TOK.')));
check('tabulka plan se už netahá',!calls.some(c=>c.url.includes('/rest/v1/plan')));

console.log('\n== 4. escapování výstupu (XSS) ==');
check('žádný dialog/alert',errors.filter(e=>e.includes('DIALOG')).length===0,errors.join(' | '));
check('žádný vložený <script>',(await pg.locator('main script').count())===0);
check('žádný vložený <img onerror>',(await pg.locator('main img').count())===0);
check('název kategorie jako text',(await pg.textContent('#cat-tree')).includes('Jídlo & <b>pití</b>'));
check('žádný <b> z názvu',(await pg.locator('#cat-tree b').count())===0);
const ws=await pg.getAttribute('.wallet-dot','style');
check('nesmyslná barva sanitizována',/888888|rgb\(136, 136, 136\)/.test(ws),ws);

console.log('\n== 5. Přehled: plán se bere ze záznamů typu plán ==');
check('příjmy = jen skutečnost (90 000)',txt(await pg.textContent('#sum-prijmy')).includes('90 000'));
check('výdaje = jen skutečnost (2 000)',txt(await pg.textContent('#sum-vydaje')).includes('2 000'));
check('plán příjmů = 88 000',txt(await pg.textContent('#sum-prijmy-plan')).includes('88 000'));
check('plán výdajů = 8 300',txt(await pg.textContent('#sum-vydaje-plan')).includes('8 300'));
check('zbývá = 6 300',txt(await pg.textContent('#sum-zbyva')).includes('6 300'));
// 10000 + 90000 - 1200 - 800 = 98 000 (se započtením plánu by vyšlo 177 700)
check('zůstatek ignoruje plán (98 000)',txt(await pg.textContent('#sum-zustatek')).includes('98 000'),
  txt(await pg.textContent('#sum-zustatek')));
const tab=txt(await pg.textContent('#plan-vs-real-table'));
check('plán vs skutečnost: 5 000 / 1 200',tab.includes('5 000')&&tab.includes('1 200'),tab);
check('kategorie bez plánu má pomlčku',tab.includes('—'));

console.log('\n== 6. Záznamy: odznak a filtr ==');
await pg.click('.tab:text-is("Záznamy")'); await pg.waitForTimeout(300);
check('kde/poznámka jako text',(await pg.textContent('#zaznamy-table')).includes('Albert & <i>spol</i>'));
check('žádný <i> ze záznamu',(await pg.locator('#zaznamy-table i').count())===0);
check('výchozí Vše = 6 řádků',(await pg.locator('#zaznamy-table tr').count())===6);
check('3 odznaky plán',(await pg.locator('#zaznamy-table .badge-plan').count())===3);
await pg.selectOption('#z-filtr','skutecnost'); await pg.waitForTimeout(200);
check('filtr skutečnost = 3 řádky bez odznaku',
  (await pg.locator('#zaznamy-table tr').count())===3&&(await pg.locator('#zaznamy-table .badge-plan').count())===0);
await pg.selectOption('#z-filtr','plan'); await pg.waitForTimeout(200);
check('filtr plán = 3 řádky s odznakem',
  (await pg.locator('#zaznamy-table tr').count())===3&&(await pg.locator('#zaznamy-table .badge-plan').count())===3);
await pg.selectOption('#z-filtr','vse'); await pg.waitForTimeout(200);

console.log('\n== 7. editace peněženky ==');
await pg.click('.tab:text-is("Peněženky")'); await pg.waitForTimeout(300);
check('tlačítko upravit existuje',(await pg.locator('#penezenky-list .edit-btn').count())===1);
await pg.click('#penezenky-list .edit-btn'); await pg.waitForTimeout(300);
check('zůstatek předplněn',(await pg.inputValue('#w-zustatek'))==='10000.00');
check('titulek = Upravit peněženku',(await pg.textContent('#form-penezenka-title'))==='Upravit peněženku');
await pg.fill('#w-nazev','Ucet opraveny'); await pg.fill('#w-zustatek','7777');
calls.length=0;
await pg.click('#btn-penezenka'); await pg.waitForTimeout(500);
const patch=calls.find(c=>c.method==='PATCH');
check('poslán PATCH, ne POST',!!patch&&!calls.some(c=>c.method==='POST'));
check('PATCH míří na id=eq.1',!!patch&&patch.url.includes('id=eq.1'));
check('formulář se resetoval',(await pg.textContent('#form-penezenka-title'))==='Přidat peněženku');

console.log('\n== 8. záložka Plán ==');
await pg.click('.tab:text-is("Plán")'); await pg.waitForTimeout(400);
const souhrn=txt(await pg.textContent('#plan-souhrn'));
check('souhrn: příjmy 88 000',souhrn.includes('88 000'),souhrn);
check('souhrn: výdaje 8 300',souhrn.includes('8 300'));
check('souhrn: saldo 79 700',souhrn.includes('79 700'));
const sk=txt(await pg.textContent('#plan-skupiny'));
check('skupiny podle kategorií + Bez kategorie',sk.includes('Mzda')&&sk.includes('pití')&&sk.includes('Bez kategorie'),sk);
check('žádné staré plan-inputy',(await pg.locator('.plan-input').count())===0);
check('každá plánovaná položka má edit',(await pg.locator('#plan-skupiny .edit-btn').count())===3);

console.log('\n== 9. založení plánované položky ==');
await pg.click('button:has-text("+ Plánovaná položka")'); await pg.waitForTimeout(400);
check('přepnuto na Záznamy',await pg.isVisible('#view-zaznamy'));
check('typ položky předvolen na plán',(await pg.inputValue('#z-polozka'))==='plan');
await pg.fill('#z-castka','1234'); await pg.fill('#z-datum',d(28)); await pg.fill('#z-kde','Test');
calls.length=0;
await pg.click('#btn-zaznam'); await pg.waitForTimeout(500);
const post=calls.find(c=>c.method==='POST');
check('POST posílá typ_polozky=plan',!!post&&JSON.parse(post.body).typ_polozky==='plan',post&&post.body);

console.log('\n== 10. editace plánované položky si drží typ ==');
await pg.click('.tab:text-is("Plán")'); await pg.waitForTimeout(300);
await pg.click('#plan-skupiny .edit-btn'); await pg.waitForTimeout(400);
check('formulář má plán',(await pg.inputValue('#z-polozka'))==='plan');
await pg.click('#btn-cancel-zaznam'); await pg.waitForTimeout(200);
check('po zrušení zpět na skutečnost',(await pg.inputValue('#z-polozka'))==='skutecnost');

console.log('\n== 11. odhlášení a obnova session ==');
await pg.click('.signout-btn'); await pg.waitForTimeout(400);
check('zpět na login',await pg.isVisible('#auth-screen'));
check('session smazána',(await pg.evaluate(()=>localStorage.getItem('homie_session')))===null);
await pg.fill('#auth-email','test@domacnost.cz'); await pg.fill('#auth-pass','spravne');
await pg.click('#btn-login'); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(300);
await pg.reload(); await pg.waitForTimeout(800);
check('po reloadu přihlášen bez hesla',await pg.isVisible('main'));

console.log('\n== 12. zůstatky peněženek ==');
await pg.click('.tab:text-is("Peněženky")'); await pg.waitForTimeout(400);
check('tabulka zůstatků je vidět',await pg.isVisible('#zustatky-table'));
const zu=await pg.evaluate(()=>{
  const cis=t=>{const v=t.textContent.replace(/[^\d+-]/g,'');return v?parseInt(v,10):0;};
  const radek=tr=>{const td=[...tr.querySelectorAll('td')];return{
    nazev:td[0].textContent.trim(),poc:cis(td[1]),pohyby:cis(td[2]),
    zust:cis(td[3]),zaplaceno:cis(td[4]),plan:cis(td[5]),vyhled:cis(td[6])};};
  return {
    radky:[...document.querySelectorAll('#zustatky-table tbody tr:not(.soucet)')].map(radek),
    celkem:radek(document.querySelector('#zustatky-table tr.soucet')),
  };
});
check('řádek na každou peněženku',zu.radky.length===1,JSON.stringify(zu.radky));
// Invarianty, ne konkrétní čísla: mock datuje záznamy dny v aktuálním měsíci,
// takže „je to v budoucnu" závisí na tom, kolikátého test běží.
check('zůstatek = počáteční + pohyby',zu.radky.every(r=>r.zust===r.poc+r.pohyby),JSON.stringify(zu.radky));
check('výhled = zůstatek + plán dopředu',zu.radky.every(r=>r.vyhled===r.zust+r.plan),JSON.stringify(zu.radky));
check('součtový řádek sedí',zu.celkem.zust===zu.radky.reduce((a,r)=>a+r.zust,0)
  &&zu.celkem.vyhled===zu.celkem.zust+zu.celkem.plan,JSON.stringify(zu.celkem));
check('zůstatek Účtu je 98 000 (plán se nepočítá)',zu.radky[0].zust===98000,JSON.stringify(zu.radky[0]));
const zpozn=txt(await pg.textContent('#zustatky-pozn'));
check('poznámka vysvětluje vztah k Pivotu',zpozn.includes('Pivot'),zpozn);
check('poznámka vysvětluje zaplaceno dopředu',/zaplaceno dopředu/.test(zpozn),zpozn);

console.log('\n== 13. záložka Rok: matice plán vs. skutečnost ==');
await pg.click('.tab:text-is("Rok")'); await pg.waitForTimeout(400);
check('pohled Rok je vidět',await pg.isVisible('#view-rok'));
check('hlavička má 12 měsíců',(await pg.locator('#rok-table th.mesic').count())===12);
const rRadky=pg.locator('#rok-table tbody tr');
// kategorie bez jediného čísla za rok se nevypisuje; tady mají data všechny tři
check('3 kategorie + součet',(await rRadky.count())===4,String(await rRadky.count()));
const rTxt=async sel=>txt(await pg.locator(sel).textContent());
const mzda=await rTxt('#rok-table tbody tr:nth-child(1)');
check('Mzda: plán 88 000 a skutečnost 90 000',mzda.includes('88 000')&&mzda.includes('90 000'),mzda);
const jidlo=await rTxt('#rok-table tbody tr:nth-child(2)');
check('Jídlo: plán −5 000 a skutečnost −1 200',jidlo.includes('-5 000')&&jidlo.includes('-1 200'),jidlo);
// Součet bere i plán bez kategorie (−3 300), takže NENÍ součtem vypsaných řádků:
// plán 88 000 − 5 000 − 3 300 = 79 700, skutečnost 90 000 − 1 200 − 800 = 88 000
const soucet=await rTxt('#rok-table tr.soucet');
check('součet 79 700 / 88 000 (včetně položky bez kategorie)',
  soucet.includes('79 700')&&soucet.includes('88 000'),soucet);
check('překročení plánu je červené',(await pg.locator('#rok-table td.diff-over').count())>=1,
  'diff-over: '+(await pg.locator('#rok-table td.diff-over').count()));
check('nepřekročené je zelené',(await pg.locator('#rok-table td.diff-ok').count())>=2);
check('buňka bez plánu nic neradí',
  (await pg.locator('#rok-table tbody tr:nth-child(3) td.diff-over, #rok-table tbody tr:nth-child(3) td.diff-ok').count())<24);
check('názvy kategorií jako text',mzda.includes('<script>'),mzda);
check('žádný <script> z názvu',(await pg.locator('#view-rok script').count())===0);

await pg.click('#rok-table tbody tr:nth-child(1) td.kat'); await pg.waitForTimeout(300);
check('rozklik ukáže podkategorii',(await rTxt('#rok-table')).includes('Peta'));
check('po rozkliku je o řádek víc',(await rRadky.count())===5,String(await rRadky.count()));
await pg.click('#rok-table tbody tr:nth-child(1) td.kat'); await pg.waitForTimeout(300);
check('druhý klik zabalí',!(await rTxt('#rok-table')).includes('Peta'));

// --- souhrn za kvartály, pololetí a rok (#6) ---
const sou=await pg.evaluate(()=>{
  const tds=[...document.querySelectorAll('#rok-souhrn tr.soucet td')].slice(1);
  const cis=t=>{const v=t.textContent.replace(/[^\d+-]/g,'');return v?parseInt(v,10):0;};
  const out={};
  ['Q1','Q2','Q3','Q4','H1','H2','Rok'].forEach((k,i)=>{
    out[k]={plan:cis(tds[i*3]),skut:cis(tds[i*3+1]),rozdil:cis(tds[i*3+2])};
  });
  return out;
});
check('souhrn má 7 skupin × 3 sloupce',
  (await pg.locator('#rok-souhrn tr.soucet td').count())===22,
  String(await pg.locator('#rok-souhrn tr.soucet td').count()));
// Kritérium z #6: kvartály i pololetí musí dát totéž co roční sloupec.
check('Q1+Q2+Q3+Q4 = Rok (plán)',sou.Q1.plan+sou.Q2.plan+sou.Q3.plan+sou.Q4.plan===sou.Rok.plan,JSON.stringify(sou));
check('Q1+Q2+Q3+Q4 = Rok (skutečnost)',sou.Q1.skut+sou.Q2.skut+sou.Q3.skut+sou.Q4.skut===sou.Rok.skut,JSON.stringify(sou));
check('H1+H2 = Rok (plán)',sou.H1.plan+sou.H2.plan===sou.Rok.plan,JSON.stringify(sou));
check('H1+H2 = Rok (skutečnost)',sou.H1.skut+sou.H2.skut===sou.Rok.skut,JSON.stringify(sou));
check('rozdíl = skutečnost − plán',sou.Rok.rozdil===sou.Rok.skut-sou.Rok.plan,JSON.stringify(sou.Rok));
// a totéž proti měsíční matici z #5
const mesicniSoucet=await pg.evaluate(()=>{
  const tds=[...document.querySelectorAll('#rok-table tr.soucet td')].slice(1);
  const cis=t=>{const v=t.textContent.replace(/[^\d+-]/g,'');return v?parseInt(v,10):0;};
  let plan=0,skut=0;
  for(let i=0;i<12;i++){plan+=cis(tds[i*2]);skut+=cis(tds[i*2+1]);}
  return {plan,skut};
});
check('součet 12 měsíců = roční sloupec',
  mesicniSoucet.plan===sou.Rok.plan&&mesicniSoucet.skut===sou.Rok.skut,
  JSON.stringify({mesicni:mesicniSoucet,rok:sou.Rok}));
// plán 88 000 − 5 000 − 3 300 − 1 000, skutečnost 90 000 − 1 200 − 800 − 4 000
check('roční čísla sedí na data (78 700 / 84 000)',
  sou.Rok.plan===78700&&sou.Rok.skut===84000,JSON.stringify(sou.Rok));

const letos=await pg.textContent('#rok-label');
await pg.click('#view-rok .month-nav button:first-child'); await pg.waitForTimeout(400);
check('přepnutí roku zpět',(await pg.textContent('#rok-label'))===String(+letos-1));
check('rok bez dat má prázdný stav',await pg.isVisible('#rok-empty'));
check('v prázdném roce se souhrn schová',!(await pg.isVisible('#rok-souhrn-blok')));
await pg.click('#view-rok .month-nav button:last-child'); await pg.waitForTimeout(400);
check('zpět na letošek',(await pg.textContent('#rok-label'))===letos);

console.log('\n== 14. stránkování: víc záznamů než strop PostgRESTu ==');
// Po importu historie má tabulka 22 tisíc řádků. Jeden GET by vrátil jen
// prvních MAX_ROWS a appka by tiše počítala s osekanými daty, takže tohle
// hlídá, že se dotahují všechny stránky.
const POCET=2500;
const puvodni=DB.zaznamy;
DB.zaznamy=Array.from({length:POCET},(_,i)=>({
  id:10000+i,datum:d((i%28)+1),castka:'1.00',typ:'vydaj',typ_polozky:'skutecnost',
  kategorie_id:9,kde:'Řádek '+i,poznamka:null,penezenka_id:1}));
calls.length=0;
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(1200);
const nacteno=await pg.evaluate(()=>zaznamy.length);
check(`načteno všech ${POCET} záznamů, ne jen ${MAX_ROWS}`,nacteno===POCET,'načteno '+nacteno);
const strankyZaznamu=calls.filter(c=>c.method==='GET'&&c.url.includes('/rest/v1/zaznamy'));
check('dotahovalo se po stránkách',strankyZaznamu.length>=Math.ceil(POCET/MAX_ROWS),
  strankyZaznamu.length+' dotazů');
check('každá stránka má limit i offset',
  strankyZaznamu.every(c=>c.url.includes('limit=')&&c.url.includes('offset=')),
  strankyZaznamu.map(c=>c.url).join(' | '));
check('řazení je deterministické (rozstřel podle id)',
  strankyZaznamu.every(c=>/order=datum\.desc,id\.desc/.test(decodeURIComponent(c.url))),
  strankyZaznamu.map(c=>c.url).join(' | '));
// 2500 výdajů po 1 Kč z počátečního zůstatku 10 000
check('zůstatek počítá se všemi záznamy (7 500)',
  txt(await pg.textContent('#sum-zustatek')).includes('7 500'),
  await pg.textContent('#sum-zustatek'));
DB.zaznamy=puvodni;

console.log('\n== chyby v konzoli ==');
// 400 = záměrně špatné heslo v testu 2
const real=errors.filter(e=>!e.includes('net::ERR_')&&!e.includes('fonts.googleapis')
  &&!/Failed to load resource.*400/.test(e));
check('žádné JS chyby',real.length===0,real.join(' | '));

await b.close();
console.log('\n'+(fails.length?'SELHALO: '+fails.length+' → '+fails.join(', '):'VŠECHNY TESTY PROŠLY'));
process.exit(fails.length?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2)});
