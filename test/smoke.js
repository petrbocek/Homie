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
    // Kategorie, kam patří obojí — vklad i výběr. Musí se nabídnout
    // u příjmu i u výdaje; v datech schválně nemá záznam, ať nerozhodí
    // součty v Přehledu a v matici Rok.
    {id:7,nazev:'Sporeni',parent_id:null,typ:'obe',kod:'7',poradi:3},
  ],
  penezenky:[{id:1,nazev:'Ucet <img src=x onerror=alert(2)>',pocatecni_zustatek:'10000.00',
              barva:'red;background:url(javascript:alert(3))'},
             {id:2,nazev:'Kreditka',pocatecni_zustatek:'0.00',barva:'#f0a860'},
             // Skrytá a prázdná — nesmí být v nabídkách ani v tabulce zůstatků.
             {id:3,nazev:'Stravenka',pocatecni_zustatek:'0.00',barva:'#a860f0',skryta:true}],
  zaznamy:[
    {id:100,datum:d(3),castka:'90000.00',typ:'prijem',typ_polozky:'skutecnost',kategorie_id:11,kde:'Demos',poznamka:null,penezenka_id:1},
    {id:101,datum:d(5),castka:'1200.00',typ:'vydaj',typ_polozky:'skutecnost',kategorie_id:91,kde:'Albert & <i>spol</i>',poznamka:'pozn "x" <hr>',penezenka_id:1},
    {id:102,datum:d(6),castka:'800.00',typ:'vydaj',typ_polozky:'skutecnost',kategorie_id:10,kde:'Action',poznamka:null,penezenka_id:1,pravidelna:true},
    // Příjem ve výdajové kategorii — Ostatni v reálných datech mívá obojí.
    // Bez toho projde i součet, který znaménko ignoruje a sčítá absolutní
    // hodnoty (za 9/2026 to dávalo 131 366 místo −17 326).
    {id:104,datum:d(2),castka:'3000.00',typ:'prijem',typ_polozky:'skutecnost',kategorie_id:10,kde:'Vratka',poznamka:null,penezenka_id:1},
    {id:200,datum:d(15),castka:'88000.00',typ:'prijem',typ_polozky:'plan',kategorie_id:11,kde:'Demos',poznamka:'Plat',penezenka_id:1},
    {id:201,datum:d(20),castka:'5000.00',typ:'vydaj',typ_polozky:'plan',kategorie_id:91,kde:'NA',poznamka:null,penezenka_id:1},
    {id:202,datum:d(25),castka:'3300.00',typ:'vydaj',typ_polozky:'plan',kategorie_id:null,kde:'Colliery',poznamka:'Bez kategorie',penezenka_id:1},
    // Jiný měsíc téhož roku, kvůli matici v záložce Rok: skutečnost přetáhla
    // plán, takže musí zčervenat. Bez peněženky, ať to nerozhodí zůstatek,
    // a mimo aktuální měsíc, ať to nerozhodí oddíly počítané po měsíci.
    {id:103,datum:d2(10),castka:'4000.00',typ:'vydaj',typ_polozky:'skutecnost',kategorie_id:10,kde:'Přetah',poznamka:null,penezenka_id:null},
    {id:203,datum:d2(12),castka:'1000.00',typ:'vydaj',typ_polozky:'plan',kategorie_id:10,kde:'Přetah plán',poznamka:null,penezenka_id:null},
    // Převod: splátka kreditky 2 000 Kč z Účtu. Obě nohy mají stejnou skupinu.
    // Do výdajů ani příjmů měsíce se počítat nesmí, do zůstatků peněženek ano.
    {id:300,datum:d(7),castka:'2000.00',typ:'vydaj',typ_polozky:'skutecnost',kategorie_id:10,
     kde:'Kreditka',poznamka:'splátka',penezenka_id:1,prevod_skupina:'u-test'},
    {id:301,datum:d(7),castka:'2000.00',typ:'prijem',typ_polozky:'skutecnost',kategorie_id:10,
     kde:'Ucet',poznamka:'splátka',penezenka_id:2,prevod_skupina:'u-test'},
  ],
  // Odečty měřidel (#9). Datumy jsou schválně fixní — záložka Energie se
  // neváže na aktuální měsíc, bere posledních N odečtů. Třetí řádek je výměna
  // vodoměru: stav spadne ze 110 na 5 m³ a naivní odčítání by vyrobilo −105.
  energie_odecty:[
    {id:1,datum:'2026-01-31',voda:'100.00',t1:'1000.00',t2:'5000.00',
     vymena_vodomer:false,vymena_elektromer:false,poznamka:null,zdroj_radek:2},
    {id:2,datum:'2026-02-28',voda:'110.00',t1:'1050.00',t2:'5200.00',
     vymena_vodomer:false,vymena_elektromer:false,poznamka:null,zdroj_radek:3},
    {id:3,datum:'2026-03-31',voda:'5.00',t1:'1100.00',t2:'5400.00',
     vymena_vodomer:true,vymena_elektromer:false,poznamka:'nový vodoměr',zdroj_radek:4},
    {id:4,datum:'2026-04-30',voda:'12.00',t1:'1150.00',t2:'5600.00',
     vymena_vodomer:false,vymena_elektromer:false,poznamka:null,zdroj_radek:5},
  ],
  // Snímky čistého jmění (#10). Mezi 2021-02 a 2021-04 schválně chybí měsíc —
  // v reálných datech chybí prosinec 2022 a změna je pak za dvě období.
  sporeni:[
    {id:1,datum:'2021-01-01',penzijko:'100000.00',uniqua:'200000.00',amundi:'300000.00',
     garant:'0.00',hypoteka:'-2000000.00',pujcky:'-100000.00',
     akarta:null,ucet:null,rezerva:null,projekce:false,poznamka:null,zdroj_radek:2},
    {id:2,datum:'2021-02-01',penzijko:'110000.00',uniqua:'210000.00',amundi:'310000.00',
     garant:'0.00',hypoteka:'-1990000.00',pujcky:'-95000.00',
     akarta:'5000.00',ucet:'45000.00',rezerva:'20000.00',projekce:false,poznamka:null,zdroj_radek:3},
    {id:3,datum:'2021-04-01',penzijko:'120000.00',uniqua:'220000.00',amundi:'320000.00',
     garant:'0.00',hypoteka:'-1980000.00',pujcky:'-90000.00',
     akarta:'1000.00',ucet:'29000.00',rezerva:'20000.00',projekce:false,poznamka:null,zdroj_radek:4},
    {id:4,datum:'2021-05-01',penzijko:'130000.00',uniqua:'230000.00',amundi:'330000.00',
     garant:'0.00',hypoteka:'-1970000.00',pujcky:'-85000.00',
     akarta:'0.00',ucet:'40000.00',rezerva:'20000.00',projekce:true,poznamka:null,zdroj_radek:5},
  ],
  // Druhé období je dávno skončené a nese HTML v datu „do" — nesmí se
  // vyrenderovat jako kód a nesmí se vybrat pro odečty z roku 2026.
  energie_cenik:[
    {id:2,platnost_od:'2015-01-01',platnost_do:'2015-11-30 <script>alert(9)</script>',
     vt:'4.00',nt:'2.00',mesicni_fix:'50.00',voda:'80.00',
     zaloha_elektrina:'1000.00',zaloha_voda:'300.00',poznamka:null},
    {id:1,platnost_od:'2015-12-01',platnost_do:null,
     vt:'6.00',nt:'3.00',mesicni_fix:'100.00',voda:'90.00',
     zaloha_elektrina:'2000.00',zaloha_voda:'500.00',poznamka:null},
  ],
};

// Strop PostgRESTu na počet řádků v jedné odpovědi (u Supabase bývá 1000).
const MAX_ROWS=1000;

const calls=[], fails=[];
let zpomal=false;          // zpomalit odpovědi na zaznamy (test souběžnosti)
let skryjPocet=false;      // neposlat expose-headers (test záložní cesty)
let dalsiId=900;           // id pro nově vytvořené řádky, unikátní napříč POSTy
const beh=[];              // [začátek, konec] každé zpomalené odpovědi
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

// Zadávací formuláře jsou v dialogu. Před prací s polem si ho test otevře a
// před klikem mimo dialog ho zavře — stejně jako člověk, který se k tabulce
// pod otevřeným dialogem taky nedoklikne. Samotná mechanika dialogu (tlačítko
// otevře, ✕ / Escape / klik mimo zavřou, editace otevře) má vlastní sekci.
const vDlg=async sel=>{
  const akce=await pg.evaluate(s=>{
    const prekryv=()=>!!document.querySelector('.dlg-pozadi.open,.rozpad-pozadi.open');
    let el=null;
    // Playwright selektory jako .tab:text-is(…) nejsou platné CSS. Takové
    // míří vždy na stránku, ne na pole v dialogu, takže překryv patří zavřít.
    try{el=document.querySelector(s);}catch(e){return prekryv()?{zavri:true}:null;}
    if(!el)return prekryv()?{zavri:true}:null;
    const d=el.closest('.dlg-pozadi');
    if(d)return d.classList.contains('open')?null:{otevri:d.id};
    // Rozpad si jeho vlastní sekce řídí sama, do té se neplete.
    if(el.closest('.rozpad-pozadi'))return null;
    return prekryv()?{zavri:true}:null;
  },sel);
  if(!akce)return;
  if(akce.otevri)await pg.evaluate(i=>otevriDlg(i),akce.otevri);
  else await pg.evaluate(()=>{zavriDlg();zavriRozpad();});
  await pg.waitForTimeout(120);
};
const fill=async(sel,v)=>{await vDlg(sel);return pg.fill(sel,v);};
const klik=async(sel,opts)=>{await vDlg(sel);return pg.click(sel,opts);};
const vyber=async(sel,v)=>{await vDlg(sel);return pg.selectOption(sel,v);};
const zaskrtni=async sel=>{await vDlg(sel);return pg.check(sel);};
const odskrtni=async sel=>{await vDlg(sel);return pg.uncheck(sel);};
const hodnota=async sel=>{await vDlg(sel);return pg.inputValue(sel);};
const zaskrtnuto=async sel=>{await vDlg(sel);return pg.isChecked(sel);};
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
    const vysek=rows.slice(od,od+Math.min(chce,MAX_ROWS));
    const hlavicky={};
    // Na `Prefer: count=exact` vrací PostgREST počet v Content-Range. Appka
    // z něj počítá offsety dopředu, aby šly stránky stahovat paralelně.
    if((req.headers()['prefer']||'').includes('count=exact')){
      hlavicky['content-range']=`${od}-${Math.max(od,od+vysek.length-1)}/${rows.length}`;
      // Content-Range není mezi bezpečnými CORS hlavičkami: bez tohohle ji
      // prohlížeč před stránkou schová a appka spadne na sériové stahování.
      if(!skryjPocet)hlavicky['access-control-expose-headers']='content-range';
    }
    // Zpomalení se zapíná jen pro test souběžnosti; jinak by se vlekla celá sada.
    if(zpomal&&t==='zaznamy'){
      const zacatek=Date.now();
      await new Promise(r=>setTimeout(r,60));
      beh.push([zacatek,Date.now()]);
    }
    return route.fulfill({status:200,contentType:'application/json',
      headers:hlavicky,body:JSON.stringify(vysek)});
  }
  if(method==='POST'){const r=JSON.parse(req.postData());const a=Array.isArray(r)?r:[r];
    // Unikátní id napříč všemi POSTy. Dokud se vracelo 900+index, dostaly dva
    // samostatně zapsané záznamy totéž id a úprava pak sáhla na ten dřívější.
    return route.fulfill({status:201,contentType:'application/json',
      body:JSON.stringify(a.map(x=>({id:dalsiId++,...x})))});}
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
await fill('#auth-email','test@domacnost.cz'); await fill('#auth-pass','blbe');
await klik('#btn-login'); await pg.waitForTimeout(400);
check('chyba se zobrazí',await pg.isVisible('#auth-err'));
check('chyba je česky',(await pg.textContent('#auth-err')).includes('Nesprávný'));
check('pořád zamčeno',await pg.isVisible('#auth-screen'));
check('tlačítko znovu aktivní',!(await pg.isDisabled('#btn-login')));

console.log('\n== 3. správné heslo ==');
await fill('#auth-pass','spravne'); await klik('#btn-login');
await pg.waitForSelector('main',{state:'visible',timeout:5000}); await pg.waitForTimeout(500);
check('appka odemčena',await pg.isVisible('main'));
check('loading zmizel',!(await pg.isVisible('#loading')));
check('e-mail v hlavičce',(await pg.textContent('#user-email'))==='test@domacnost.cz');
check('heslo vymazáno z pole',(await hodnota('#auth-pass'))==='');
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
check('příjmy = jen skutečnost (93 000)',txt(await pg.textContent('#sum-prijmy')).includes('93 000'));
check('výdaje = jen skutečnost (2 000)',txt(await pg.textContent('#sum-vydaje')).includes('2 000'));
check('plán příjmů = 88 000',txt(await pg.textContent('#sum-prijmy-plan')).includes('88 000'));
check('plán výdajů = 8 300',txt(await pg.textContent('#sum-vydaje-plan')).includes('8 300'));
check('zbývá = 6 300',txt(await pg.textContent('#sum-zbyva')).includes('6 300'));
// 10000 + 90000 - 1200 - 800 = 98 000 (se započtením plánu by vyšlo 177 700)
check('zůstatek ignoruje plán (101 000)',txt(await pg.textContent('#sum-zustatek')).includes('101 000'),
  txt(await pg.textContent('#sum-zustatek')));
const tab=txt(await pg.textContent('#plan-vs-real-table'));
check('plán vs skutečnost: 5 000 / 1 200',tab.includes('5 000')&&tab.includes('1 200'),tab);
check('kategorie bez plánu má pomlčku',tab.includes('—'));
// Mrtvá kategorie v tabulce jen překáží. „Sporeni" je v osnově, ale nemá
// za celý rok jediný záznam ani plán — vypadnout musí; ostatní zůstat.
check('kategorie bez záznamu za celý rok se nevypisuje',
  !tab.includes('Sporeni')&&tab.includes('Jídlo'),tab);
// Ale jen za rok, ne za měsíc: s loňským záznamem se v letošku pořád schová,
// a jakmile dostane záznam v letošku, objeví se i v měsíci, kde nic nemá.
const zivaPoPridani=await pg.evaluate(()=>{
  const m=new Date().toISOString().slice(0,7);
  zaznamy.push({id:99902,datum:m+'-02',castka:'500.00',typ:'vydaj',typ_polozky:'skutecnost',
    kategorie_id:7,kde:'Conseq',poznamka:null,penezenka_id:1});
  renderPrehled();
  const t=document.getElementById('plan-vs-real-table').textContent;
  zaznamy=zaznamy.filter(z=>z.id!==99902); renderPrehled();
  return t.includes('Sporeni');
});
check('se záznamem v tomto roce se kategorie vrátí',zivaPoPridani);

// Kategorie Ostatni má tenhle měsíc výdaj 800 a příjem 3 000. Součet musí
// brát znaménko: 3 000 − 800 = +2 200. Dokud se sčítaly absolutní hodnoty,
// vycházelo 3 800 a nikdo si toho nevšiml, protože žádná kategorie v testech
// obojí neměla.
const ostatni=await pg.evaluate(()=>{
  const cis=t=>{const v=t.replace(/[^\d-]/g,'');return v?parseInt(v,10):0;};
  const tr=[...document.querySelectorAll('#plan-vs-real-table tr')]
    .find(r=>r.children[0].textContent.includes('Ostatni'));
  return tr?{plan:cis(tr.children[1].textContent),skut:cis(tr.children[2].textContent)}:null;
});
check('součet kategorie bere znaménko (+2 200, ne 3 800)',
  ostatni&&ostatni.skut===2200,JSON.stringify(ostatni));
// Výdajová kategorie musí vyjít záporně, ne jako kladné číslo bez znaménka.
const jidloCis=await pg.evaluate(()=>{
  const cis=t=>{const v=t.replace(/[^\d-]/g,'');return v?parseInt(v,10):0;};
  const tr=[...document.querySelectorAll('#plan-vs-real-table tr')]
    .find(r=>r.children[0].textContent.includes('Jídlo'));
  return {plan:cis(tr.children[1].textContent),skut:cis(tr.children[2].textContent)};
});
check('výdaje jsou se znaménkem mínus (−5 000 / −1 200)',
  jidloCis.plan===-5000&&jidloCis.skut===-1200,JSON.stringify(jidloCis));

// Tatáž kategorie a měsíc musí dát stejné číslo v Přehledu, v rozpadu pod
// kliknutím i v matici Roku. Rozpad to odhalil u 9/2026 (131 366 vs −17 326).
await klik('#plan-vs-real-table tr:has-text("Ostatni") td:nth-child(3)');
await pg.waitForTimeout(300);
const zRozpadu=await pg.evaluate(()=>{
  const v=document.getElementById('rozpad-soucet').textContent.replace(/[^\d-]/g,'');
  return v?parseInt(v,10):0;});
await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
check('rozpad dá stejné číslo jako Přehled',zRozpadu===ostatni.skut,
  `rozpad ${zRozpadu} vs přehled ${ostatni.skut}`);
await klik('.tab:text-is("Rok")'); await pg.waitForTimeout(500);
const zMatice=await pg.evaluate(()=>{
  const cis=t=>{const v=t.replace(/[^\d-]/g,'');return v?parseInt(v,10):0;};
  const tr=[...document.querySelectorAll('#rok-table tbody tr')]
    .find(r=>r.children[0].textContent.includes('Ostatni'));
  return cis(tr.children[2+2*new Date().getMonth()].textContent);
});
check('matice Roku dá stejné číslo jako Přehled',zMatice===ostatni.skut,
  `matice ${zMatice} vs přehled ${ostatni.skut}`);
await klik('.tab:text-is("Přehled")'); await pg.waitForTimeout(300);

console.log('\n== 6. Záznamy: odznak a filtr ==');
await klik('.tab:text-is("Záznamy")'); await pg.waitForTimeout(300);
check('kde/poznámka jako text',(await pg.textContent('#zaznamy-table')).includes('Albert & <i>spol</i>'));
check('žádný <i> ze záznamu',(await pg.locator('#zaznamy-table i').count())===0);
check('výchozí Vše = 9 řádků',(await pg.locator('#zaznamy-table tr').count())===9);
check('3 odznaky plán',(await pg.locator('#zaznamy-table .badge-plan').count())===3);
await vyber('#z-filtr','skutecnost'); await pg.waitForTimeout(200);
check('filtr skutečnost = 6 řádků bez odznaku',
  (await pg.locator('#zaznamy-table tr').count())===6&&(await pg.locator('#zaznamy-table .badge-plan').count())===0);
await vyber('#z-filtr','plan'); await pg.waitForTimeout(200);
check('filtr plán = 3 řádky s odznakem',
  (await pg.locator('#zaznamy-table tr').count())===3&&(await pg.locator('#zaznamy-table .badge-plan').count())===3);
await vyber('#z-filtr','prevody'); await pg.waitForTimeout(200);
check('filtr převody = obě nohy jednoho převodu',
  (await pg.locator('#zaznamy-table tr').count())===2&&(await pg.locator('#zaznamy-table .prevod').count())===2);
await vyber('#z-filtr','vse'); await pg.waitForTimeout(200);

console.log('\n== 7. editace peněženky ==');
await klik('.tab:text-is("Peněženky")'); await pg.waitForTimeout(300);
check('tlačítko upravit u každé peněženky',(await pg.locator('#penezenky-list .edit-btn').count())===3);
await klik('#penezenky-list .edit-btn'); await pg.waitForTimeout(300);
check('zůstatek předplněn',(await hodnota('#w-zustatek'))==='10000.00');
check('titulek = Upravit peněženku',(await pg.textContent('#form-penezenka-title'))==='Upravit peněženku');
await fill('#w-nazev','Ucet opraveny'); await fill('#w-zustatek','7777');
calls.length=0;
await klik('#btn-penezenka'); await pg.waitForTimeout(500);
const patch=calls.find(c=>c.method==='PATCH');
check('poslán PATCH, ne POST',!!patch&&!calls.some(c=>c.method==='POST'));
check('PATCH míří na id=eq.1',!!patch&&patch.url.includes('id=eq.1'));
check('formulář se resetoval',(await pg.textContent('#form-penezenka-title'))==='Přidat peněženku');

console.log('\n== 8. záložka Plán ==');
await klik('.tab:text-is("Plán")'); await pg.waitForTimeout(400);
const souhrn=txt(await pg.textContent('#plan-souhrn'));
check('souhrn: příjmy 88 000',souhrn.includes('88 000'),souhrn);
check('souhrn: výdaje 8 300',souhrn.includes('8 300'));
check('souhrn: saldo 79 700',souhrn.includes('79 700'));
const sk=txt(await pg.textContent('#plan-skupiny'));
check('skupiny podle kategorií + Bez kategorie',sk.includes('Mzda')&&sk.includes('pití')&&sk.includes('Bez kategorie'),sk);
check('žádné staré plan-inputy',(await pg.locator('.plan-input').count())===0);
check('každá plánovaná položka má edit',(await pg.locator('#plan-skupiny .edit-btn').count())===3);

console.log('\n== 9. založení plánované položky ==');
await klik('button:has-text("+ Plánovaná položka")'); await pg.waitForTimeout(400);
check('přepnuto na Záznamy',await pg.isVisible('#view-zaznamy'));
check('typ položky předvolen na plán',(await hodnota('#z-polozka'))==='plan');
await fill('#z-castka','1234'); await fill('#z-datum',d(28)); await fill('#z-kde','Test');
calls.length=0;
await klik('#btn-zaznam'); await pg.waitForTimeout(500);
const post=calls.find(c=>c.method==='POST');
check('POST posílá typ_polozky=plan',!!post&&JSON.parse(post.body).typ_polozky==='plan',post&&post.body);

console.log('\n== 10. editace plánované položky si drží typ ==');
await klik('.tab:text-is("Plán")'); await pg.waitForTimeout(300);
await klik('#plan-skupiny .edit-btn'); await pg.waitForTimeout(400);
check('formulář má plán',(await hodnota('#z-polozka'))==='plan');
await klik('#btn-cancel-zaznam'); await pg.waitForTimeout(200);
check('po zrušení zpět na skutečnost',(await hodnota('#z-polozka'))==='skutecnost');

console.log('\n== 11. odhlášení a obnova session ==');
await klik('.signout-btn'); await pg.waitForTimeout(400);
check('zpět na login',await pg.isVisible('#auth-screen'));
check('session smazána',(await pg.evaluate(()=>localStorage.getItem('homie_session')))===null);
await fill('#auth-email','test@domacnost.cz'); await fill('#auth-pass','spravne');
await klik('#btn-login'); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(300);
await pg.reload(); await pg.waitForTimeout(800);
check('po reloadu přihlášen bez hesla',await pg.isVisible('main'));

console.log('\n== 12. pravidelné (mandatorní) platby ==');
await klik('.tab:text-is("Přehled")'); await pg.waitForTimeout(300);
check('souhrn ukazuje mandatorní výdaje',txt(await pg.textContent('#sum-vydaje-mand')).includes('800'),
  await pg.textContent('#sum-vydaje-mand'));
check('souhrn ukazuje podíl na výdajích',/%/.test(await pg.textContent('#sum-vydaje-mand')),
  await pg.textContent('#sum-vydaje-mand'));
await klik('.tab:text-is("Záznamy")'); await pg.waitForTimeout(300);
check('pravidelná platba má odznak',(await pg.locator('#zaznamy-table .badge-pravidelna').count())===1,
  String(await pg.locator('#zaznamy-table .badge-pravidelna').count()));
await vyber('#z-filtr','pravidelne'); await pg.waitForTimeout(300);
check('filtr Jen pravidelné nechá 1 řádek',(await pg.locator('#zaznamy-table tr').count())===1,
  String(await pg.locator('#zaznamy-table tr').count()));
await vyber('#z-filtr','vse'); await pg.waitForTimeout(300);
// Stejná dvojice kde+kategorie jako u označeného záznamu → appka ji navrhne sama,
// aby označení nezůstalo jen na historii.
await fill('#z-kde','Action'); await vyber('#z-kategorie','10'); await pg.waitForTimeout(300);
check('u shodné dvojice se pravidelná navrhne',await zaskrtnuto('#z-pravidelna'));
await fill('#z-kde','Neznámý obchod'); await pg.waitForTimeout(200);
await odskrtni('#z-pravidelna');
await vyber('#z-kategorie','91'); await pg.waitForTimeout(300);
check('u neznámé dvojice se nenavrhuje',!(await zaskrtnuto('#z-pravidelna')));
await fill('#z-castka','123'); await fill('#z-datum',d(14));
await zaskrtni('#z-pravidelna');
calls.length=0;
await klik('#btn-zaznam'); await pg.waitForTimeout(500);
const postP=calls.find(c=>c.method==='POST');
check('POST posílá pravidelna=true',!!postP&&JSON.parse(postP.body).pravidelna===true,postP&&postP.body);
// Uložený záznam zůstává v paměti appky a posunul by čísla v dalších oddílech,
// tak načteme čistý stav z mocku – stejně jako to dělá oddíl 11.
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(900);

console.log('\n== 13. zůstatky peněženek ==');
await klik('.tab:text-is("Peněženky")'); await pg.waitForTimeout(400);
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
check('řádek na každou peněženku',zu.radky.length===2,JSON.stringify(zu.radky));
// Invarianty, ne konkrétní čísla: mock datuje záznamy dny v aktuálním měsíci,
// takže „je to v budoucnu" závisí na tom, kolikátého test běží.
check('zůstatek = počáteční + pohyby',zu.radky.every(r=>r.zust===r.poc+r.pohyby),JSON.stringify(zu.radky));
check('výhled = zůstatek + plán dopředu',zu.radky.every(r=>r.vyhled===r.zust+r.plan),JSON.stringify(zu.radky));
check('součtový řádek sedí',zu.celkem.zust===zu.radky.reduce((a,r)=>a+r.zust,0)
  &&zu.celkem.vyhled===zu.celkem.zust+zu.celkem.plan,JSON.stringify(zu.celkem));
// 10 000 + 90 000 − 1 200 − 800 − 2 000 (odchozí noha převodu)
check('zůstatek Účtu je 99 000 (plán ne, převod ano)',zu.radky[0].zust===99000,JSON.stringify(zu.radky[0]));
check('příchozí noha převodu je na cílové peněžence (2 000)',zu.radky[1].zust===2000,JSON.stringify(zu.radky[1]));
const zpozn=txt(await pg.textContent('#zustatky-pozn'));
check('poznámka vysvětluje vztah k Pivotu',zpozn.includes('Pivot'),zpozn);
check('poznámka vysvětluje zaplaceno dopředu',/zaplaceno dopředu/.test(zpozn),zpozn);

console.log('\n== 14. záložka Rok: matice plán vs. skutečnost ==');
await klik('.tab:text-is("Rok")'); await pg.waitForTimeout(400);
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
check('součet 79 700 / 91 000 (včetně položky bez kategorie)',
  soucet.includes('79 700')&&soucet.includes('91 000'),soucet);
check('překročení plánu je červené',(await pg.locator('#rok-table td.diff-over').count())>=1,
  'diff-over: '+(await pg.locator('#rok-table td.diff-over').count()));
check('nepřekročené je zelené',(await pg.locator('#rok-table td.diff-ok').count())>=2);
check('buňka bez plánu nic neradí',
  (await pg.locator('#rok-table tbody tr:nth-child(3) td.diff-over, #rok-table tbody tr:nth-child(3) td.diff-ok').count())<24);
check('názvy kategorií jako text',mzda.includes('<script>'),mzda);
check('žádný <script> z názvu',(await pg.locator('#view-rok script').count())===0);

await klik('#rok-table tbody tr:nth-child(1) td.kat'); await pg.waitForTimeout(300);
check('rozklik ukáže podkategorii',(await rTxt('#rok-table')).includes('Peta'));
check('po rozkliku je o řádek víc',(await rRadky.count())===5,String(await rRadky.count()));
await klik('#rok-table tbody tr:nth-child(1) td.kat'); await pg.waitForTimeout(300);
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
check('roční čísla sedí na data (78 700 / 87 000)',
  sou.Rok.plan===78700&&sou.Rok.skut===87000,JSON.stringify(sou.Rok));

const letos=await pg.textContent('#rok-label');
await klik('#view-rok .month-nav button:first-child'); await pg.waitForTimeout(400);
check('přepnutí roku zpět',(await pg.textContent('#rok-label'))===String(+letos-1));
check('rok bez dat má prázdný stav',await pg.isVisible('#rok-empty'));
check('v prázdném roce se souhrn schová',!(await pg.isVisible('#rok-souhrn-blok')));
await klik('#view-rok .month-nav button:last-child'); await pg.waitForTimeout(400);
check('zpět na letošek',(await pg.textContent('#rok-label'))===letos);

console.log('\n== 15. energie: odečty, spotřeba, výměna měřidla (#9) ==');
await klik('.tab:text-is("Energie")'); await pg.waitForTimeout(300);
check('záložka Energie je vidět',await pg.isVisible('#view-energie'));
check('prázdný stav se neukazuje',!(await pg.isVisible('#energie-empty')));

const en=await pg.evaluate(()=>{
  const r={};
  for(const tr of document.querySelectorAll('#energie-mesice tbody tr')){
    const td=[...tr.children].map(x=>x.textContent.replace(/[\s\u00a0\u202f]+/g,' ').trim());
    r[td[0].slice(0,7)]=td;
  }
  return r;
});
// 2026-02: voda 110−100=10 m³, VT 1050−1000=50, NT 5200−5000=200 kWh
// náklad el. 50×6 + 200×3 + 100 fix = 1 000, voda 10×90 = 900, celkem 1 900
// záloha 2 000 + 500 = 2 500 → přeplatek 600
check('spotřeba je rozdíl proti předchozímu odečtu (10 / 50 / 200)',
  en['2026-02'] && en['2026-02'][1]==='10' && en['2026-02'][2]==='50' && en['2026-02'][3]==='200',
  JSON.stringify(en['2026-02']));
check('náklad sazbou platnou k odečtu (1 000 / 900 / 1 900)',
  en['2026-02'] && en['2026-02'][4]==='1 000' && en['2026-02'][5]==='900' && en['2026-02'][6]==='1 900',
  JSON.stringify(en['2026-02']));
check('rozdíl proti zálohám (2 500 − 1 900 = 600)',
  en['2026-02'] && en['2026-02'][7]==='2 500' && en['2026-02'][8]==='600',
  JSON.stringify(en['2026-02']));
// Výměna vodoměru: 5 − 110 = −105 m³ je nesmysl, ten řádek se nesmí započítat.
check('měsíc s výměnou měřidla je označený',
  en['2026-03'] && /\u26a0/.test(en['2026-03'][0]),JSON.stringify(en['2026-03']));
// Odznaky .badge se v .rok-table na mobilu schovávají (v Roku je typ vidět ze
// znaménka). Tady je značka jediný signál, že měsíc není celý — musí zůstat.
await pg.setViewportSize({width:390,height:800}); await pg.waitForTimeout(200);
check('značka neúplného měsíce je vidět i na mobilu',
  await pg.isVisible('#energie-mesice .vymena'));
await pg.setViewportSize({width:1280,height:720}); await pg.waitForTimeout(200);

// Vodoměr se v březnu měnil a konečný stav starého nikdo nezapsal, takže
// spotřeba vody za ten měsíc není nula, ale neznámo. Naivní odčítání by tam
// vyrobilo −105 m³, nula by se zase čtla jako „nic jsme nespotřebovali".
check('výměna nevyrobí negativní ani nulovou spotřebu vody, ale neznámo',
  en['2026-03'] && en['2026-03'][1]==='—',JSON.stringify(en['2026-03']));
check('elektřina se přes výměnu vodoměru počítá dál (50 / 200)',
  en['2026-03'] && en['2026-03'][2]==='50' && en['2026-03'][3]==='200',JSON.stringify(en['2026-03']));
check('první odečet v historii nemá od čeho odečítat',
  en['2026-01'] && /\u26a0/.test(en['2026-01'][0]) && en['2026-01'][1]==='—'
  && en['2026-01'][2]==='—',JSON.stringify(en['2026-01']));
check('nikde negativní spotřeba',
  Object.values(en).every(r=>!r.slice(1,4).some(v=>v.startsWith('-')||v.startsWith('−'))),
  JSON.stringify(en));

const ekarty=txt(await pg.textContent('#energie-karty'));
// VT 3×50 = 150, NT 3×200 = 600 → 750 kWh; voda 10 + 0 + 7 = 17 m³
check('karta elektřiny sečte celé okno (750 kWh)',ekarty.includes('750 kWh'),ekarty);
check('karta vody sečte celé okno (17 m³)',ekarty.includes('17 m³'),ekarty);
check('karta ukazuje poslední odečet',ekarty.includes('2026-04-30'),ekarty);

const ecen=await pg.evaluate(()=>[...document.querySelectorAll('#energie-cenik tbody tr')]
  .map(tr=>[...tr.children].map(x=>x.textContent.replace(/[\s\u00a0\u202f]+/g,' ').trim())));
check('ceník má obě období',ecen.length===2,JSON.stringify(ecen));
check('platné období je první (nejnovější nahoře)',
  ecen[0][0].startsWith('2015-12-01')&&ecen[0][1]==='—',JSON.stringify(ecen[0]));
check('HTML v ceníku se vypíše jako text',
  ecen[1][1]==='2015-11-30 <script>alert(9)</script>',JSON.stringify(ecen[1]));

// Graf je dvanáct měsíců a v každém tři roky vedle sebe. Data jsou jen z 2026,
// takže 2024 a 2025 musí zůstat prázdné — ne nulové, prostě bez odečtu.
const egraf=await pg.evaluate(()=>{
  const cols=[...document.querySelectorAll('#energie-graf .bar-col')];
  return {sloupcu:cols.length,
    bar:cols.map(c=>c.querySelectorAll('.bar-par>div').length),
    popisky:cols.map(c=>c.querySelector('.bar-col-label').textContent.trim()),
    tipy:cols.flatMap(c=>[...c.querySelectorAll('.bar-par>div')].map(d=>d.title)),
    legenda:[...document.querySelectorAll('#energie-graf-legenda span')]
      .map(x=>x.textContent.replace(/[\s\u00a0\u202f]+/g,' ').trim())};
});
check('graf má sloupec za každý měsíc v roce',egraf.sloupcu===12,String(egraf.sloupcu));
check('v každém měsíci jsou tři roky',egraf.bar.every(n=>n===3),JSON.stringify(egraf.bar));
check('popisky jsou měsíce, ne měsíc/rok',
  egraf.popisky[0]==='Led'&&egraf.popisky[11]==='Pro',JSON.stringify(egraf.popisky));
check('tooltip řekne měsíc, rok a kWh',
  egraf.tipy.includes('02/2026: 250 kWh'),
  egraf.tipy.filter(t=>t.includes('2026')).join(' | '));
check('měsíc bez odečtu je prázdný, ne nulový',
  egraf.tipy.includes('02/2024: bez odečtu'),
  egraf.tipy.filter(t=>t.includes('2024')).slice(0,3).join(' | '));
check('legenda má tři roky se součtem',
  egraf.legenda.length===3&&egraf.legenda[2].startsWith('2026 ·')
  &&egraf.legenda[0].startsWith('2024 ·'),JSON.stringify(egraf.legenda));

console.log('\n== 15b. energie: zápis a úprava odečtu ==');
await klik('.tab:text-is("Energie")'); await pg.waitForTimeout(300);
check('tabulka zapsaných odečtů je vidět',
  (await pg.locator('#energie-odecty tbody tr').count())===4);
check('řádek nabízí úpravu i smazání',
  (await pg.locator('#energie-odecty tbody tr:first-child .edit-btn').count())===1
  &&(await pg.locator('#energie-odecty tbody tr:first-child .del-btn').count())===1);

// Zápis nového odečtu
calls.length=0;
await fill('#od-datum','2026-05-31');
await fill('#od-voda','20'); await fill('#od-t1','1200'); await fill('#od-t2','5800');
await fill('#od-poznamka','kontrolní');
await klik('#btn-odecet'); await pg.waitForTimeout(500);
const postOd=calls.find(c=>c.method==='POST'&&c.url.includes('energie_odecty'));
check('odečet se pošle POSTem',!!postOd,calls.map(c=>c.method+' '+c.url).join(' | '));
check('posílá se stav měřidla, ne spotřeba',
  postOd&&JSON.parse(postOd.body).voda===20&&JSON.parse(postOd.body).t1===1200,
  postOd&&postOd.body);
check('přibyl řádek',(await pg.locator('#energie-odecty tbody tr').count())===5);
const odRadky=async()=>pg.evaluate(()=>[...document.querySelectorAll('#energie-odecty tbody tr')]
  .map(tr=>[...tr.children].map(td=>td.textContent.replace(/[\s\u00a0\u202f]+/g,' ').trim())));
// 20 − 12 = 8 m³ proti dubnovému odečtu
const poZapisu=await odRadky();
check('spotřeba se dopočítá z pořadí (8 m³)',
  poZapisu[0][0].startsWith('2026-05-31')&&poZapisu[0][4]==='8',JSON.stringify(poZapisu[0]));

// Klesající stav bez zaškrtnuté výměny je přesně ta chyba, co v sheetu
// vyrobila −757 m³. Nesmí projít.
calls.length=0;
await fill('#od-datum','2026-06-30');
await fill('#od-voda','5'); await fill('#od-t1','1300'); await fill('#od-t2','5900');
await klik('#btn-odecet'); await pg.waitForTimeout(400);
check('klesající stav bez výměny neprojde',
  !calls.some(c=>c.method==='POST'),calls.map(c=>c.method+' '+c.url).join(' | '));
check('appka řekne proč',/klesl/.test(await pg.textContent('.toast')),
  await pg.textContent('.toast'));
// Se zaškrtnutou výměnou je to legitimní.
await zaskrtni('#od-vym-voda');
await klik('#btn-odecet'); await pg.waitForTimeout(500);
check('se zaškrtnutou výměnou projde',calls.some(c=>c.method==='POST'));
await odskrtni('#od-vym-voda');

// Úprava existujícího
calls.length=0;
const predUpravou=await odRadky();
check('nejnovější nahoře je odečet s výměnou',predUpravou[0][0].startsWith('2026-06-30'),
  JSON.stringify(predUpravou[0]));
await klik('#energie-odecty tbody tr:first-child .edit-btn'); await pg.waitForTimeout(300);
check('úprava předvyplní stav',(await hodnota('#od-voda'))==='5',
  await hodnota('#od-voda'));
check('úprava předvyplní zaškrtnutí výměny',await zaskrtnuto('#od-vym-voda'));
// Řádek s výměnou nemá spotřebu vody — jinak by vyšla −15.
check('u výměny se spotřeba vody nepočítá',predUpravou[0][4]==='—',JSON.stringify(predUpravou[0]));
await fill('#od-poznamka','opraveno');
await klik('#btn-odecet'); await pg.waitForTimeout(500);
const patchOd=calls.find(c=>c.method==='PATCH'&&c.url.includes('energie_odecty'));
check('úprava pošle PATCH',patchOd&&JSON.parse(patchOd.body).poznamka==='opraveno',
  patchOd?patchOd.body:'žádný PATCH');
check('formulář se vrátí do režimu zápisu',
  (await hodnota('#od-poznamka'))===''&&!(await zaskrtnuto('#od-vym-voda')));

// Dvakrát totéž datum nedává smysl
calls.length=0;
await fill('#od-datum','2026-04-30'); await fill('#od-voda','99');
await klik('#btn-odecet'); await pg.waitForTimeout(400);
check('dva odečty k témuž datu neprojdou',!calls.some(c=>c.method==='POST'));
await pg.evaluate(()=>zavriDlg());
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(800);

console.log('\n== 15c. energie: částka u odečtu a editace ceníku ==');
await klik('.tab:text-is("Energie")'); await pg.waitForTimeout(400);
const odC=await pg.evaluate(()=>[...document.querySelectorAll('#energie-odecty tbody tr')]
  .map(tr=>[...tr.children].map(td=>td.textContent.replace(/[\s\u00a0\u202f]+/g,' ').trim())));
// 2026-02-28: voda 10 m³ × 90 = 900, VT 50 × 6 + NT 200 × 3 = 900, celkem 1 800.
// Měsíční fix 100 se sem schválně nepočítá — je měsíční, ne za odečet.
const r0228=odC.find(r=>r[0].startsWith('2026-02-28'));
check('u odečtu je i částka za vodu (900)',r0228&&r0228[7]==='900',JSON.stringify(r0228));
check('u odečtu je i částka za elektřinu (900)',r0228&&r0228[8]==='900',JSON.stringify(r0228));
check('celkem je součet a bez měsíčního fixu (1 800)',r0228&&r0228[9]==='1 800',JSON.stringify(r0228));
const r0131=odC.find(r=>r[0].startsWith('2026-01-31'));
check('první odečet nemá spotřebu, tedy ani částku',
  r0131&&r0131[7]==='—'&&r0131[9]==='—',JSON.stringify(r0131));

// Ceník jde upravit
check('ceník nabízí úpravu i smazání',
  (await pg.locator('#energie-cenik tbody tr .edit-btn').count())===2);
// Tabulky jsou širší než obrazovka a scrollují do strany. Kdyby akce zůstaly
// v posledním sloupci, byly by mimo displej a řádky by nešlo upravit.
const vPrvnim=await pg.evaluate(()=>({
  odecty:!!document.querySelector('#energie-odecty tbody tr td:first-child .edit-btn'),
  cenik:!!document.querySelector('#energie-cenik tbody tr td:first-child .edit-btn'),
  prilepeny:getComputedStyle(
    document.querySelector('#energie-odecty tbody tr td:first-child')).position,
}));
check('✎/✕ jsou v prvním, přilepeném sloupci — ne mimo displej',
  vPrvnim.odecty&&vPrvnim.cenik&&vPrvnim.prilepeny==='sticky',JSON.stringify(vPrvnim));
calls.length=0;
await klik('#energie-cenik tbody tr:first-child .edit-btn'); await pg.waitForTimeout(300);
check('úprava ceníku předvyplní sazby',
  parseFloat(await hodnota('#ce-vt'))===6&&parseFloat(await hodnota('#ce-nt'))===3,
  (await hodnota('#ce-vt'))+'/'+(await hodnota('#ce-nt')));
await fill('#ce-vt','7');
// Zároveň uzavřeme otevřené období, ať jde níž otestovat navazující.
await fill('#ce-do','2026-12-31');
await klik('#btn-cenik'); await pg.waitForTimeout(500);
const patchC=calls.find(c=>c.method==='PATCH'&&c.url.includes('energie_cenik'));
check('úprava ceníku pošle PATCH',patchC&&JSON.parse(patchC.body).vt===7,
  patchC?patchC.body:'žádný PATCH');
// Změna sazby se musí hned promítnout do částek: VT 50 × 7 + NT 200 × 3 = 950.
const poZmene=await pg.evaluate(()=>[...document.querySelectorAll('#energie-odecty tbody tr')]
  .map(tr=>[...tr.children].map(td=>td.textContent.replace(/[\s\u00a0\u202f]+/g,' ').trim())))
  .then(rs=>rs.find(r=>r[0].startsWith('2026-02-28')));
check('změna sazby se hned projeví v částce (950)',poZmene&&poZmene[8]==='950',
  JSON.stringify(poZmene));

// Překrývající se období by znamenalo, že sazba k datu je nejednoznačná.
calls.length=0;
await fill('#ce-od','2026-01-01'); await fill('#ce-do','2026-06-30');
await fill('#ce-vt','9'); await fill('#ce-nt','4');
await klik('#btn-cenik'); await pg.waitForTimeout(400);
check('překrývající se období neprojde',!calls.some(c=>c.method==='POST'),
  calls.map(c=>c.method+' '+c.url).join(' | '));
check('appka řekne s čím se překrývá',/překrývá/i.test(await pg.textContent('.toast')),
  await pg.textContent('.toast'));
// Navazující období (po uzavřeném konci) už projít musí.
await fill('#ce-od','2027-01-01'); await fill('#ce-do','');
await klik('#btn-cenik'); await pg.waitForTimeout(500);
check('navazující období projde',calls.some(c=>c.method==='POST'&&c.url.includes('energie_cenik')));
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(800);

console.log('\n== 15d. výměna měřidla se zapsaným konečným stavem ==');
// Reálný případ z 3/2026: 4. 3. se měnil elektroměr, zapsal se jen vynulovaný
// nový stav a 1 132 kWh zmizelo — měsíc vyšel na 118 kWh. Když se k témuž dni
// zapíše i konečný stav starého měřidla, nemá se co ztratit.
await klik('.tab:text-is("Energie")'); await pg.waitForTimeout(400);
const odRadky2=async()=>pg.evaluate(()=>[...document.querySelectorAll('#energie-odecty tbody tr')]
  .map(tr=>[...tr.children].map(td=>td.textContent.replace(/[\s  ]+/g,' ').trim())));
const mesRadek=async m=>pg.evaluate(mm=>{
  const tr=[...document.querySelectorAll('#energie-mesice tbody tr')]
    .find(x=>x.children[0].textContent.trim().startsWith(mm));
  return tr?{bunky:[...tr.children].map(td=>td.textContent.replace(/[\s  ]+/g,' ').trim()),
             vymena:!!tr.querySelector('.vymena')}:null;
},m);

// 1) konečný stav starého elektroměru
await fill('#od-datum','2026-05-31');
await fill('#od-voda','20'); await fill('#od-t1','1200'); await fill('#od-t2','5800');
await klik('#btn-odecet'); await pg.waitForTimeout(500);
// 2) vynulovaný nový elektroměr k TÉMUŽ dni. Vodoměr se nemění, zůstává na 20.
calls.length=0;
await fill('#od-datum','2026-05-31');
await fill('#od-voda','20'); await fill('#od-t1','0'); await fill('#od-t2','0');
await zaskrtni('#od-vym-elektro');
await klik('#btn-odecet'); await pg.waitForTimeout(500);
check('druhý odečet k témuž dni projde, když je to výměna',
  calls.some(c=>c.method==='POST'&&c.url.includes('energie_odecty')),
  await pg.textContent('.toast').catch(()=>''));
await odskrtni('#od-vym-elektro');

const paru=await odRadky2();
check('vynulovaný řádek je v dni až za konečným stavem',
  paru[0][0].startsWith('2026-05-31')&&paru[1][0].startsWith('2026-05-31')
  &&paru[0][2]==='0'&&paru[1][2]==='1 200',JSON.stringify([paru[0],paru[1]]));
check('u výměny se zapsaným koncem je spotřeba nula, ne neznámo',
  paru[0][5]==='0'&&paru[0][6]==='0'&&paru[0][4]==='0',JSON.stringify(paru[0]));
check('konečný stav starého měřidla se započítá (50 / 200)',
  paru[1][5]==='50'&&paru[1][6]==='200',JSON.stringify(paru[1]));

// 3) další běžný odečet na novém měřidle
calls.length=0;
await fill('#od-datum','2026-06-30');
await fill('#od-voda','26'); await fill('#od-t1','40'); await fill('#od-t2','60');
await klik('#btn-odecet'); await pg.waitForTimeout(500);
check('odečet na novém měřidle nehlásí pokles proti starému',
  calls.some(c=>c.method==='POST'),await pg.textContent('.toast').catch(()=>''));
const poNovem=await odRadky2();
check('spotřeba na novém měřidle se počítá od nuly (40 / 60)',
  poNovem[0][0].startsWith('2026-06-30')&&poNovem[0][5]==='40'&&poNovem[0][6]==='60',
  JSON.stringify(poNovem[0]));

const kveten=await mesRadek('2026-05');
check('měsíc s výměnou sečte oba řádky (250 kWh)',
  kveten&&kveten.bunky[2]==='50'&&kveten.bunky[3]==='200',JSON.stringify(kveten));
check('měsíc s výměnou už není označený jako neúplný',kveten&&!kveten.vymena,
  JSON.stringify(kveten));
const vsechnyOd=await odRadky2();
check('nikde negativní spotřeba',
  !vsechnyOd.some(r=>r.slice(4,10).some(v=>v.startsWith('-')||v.startsWith('−'))),
  JSON.stringify(vsechnyOd.filter(r=>r.slice(4,10).some(v=>v.startsWith('-')))));

// Dvojí zápis k jednomu dni bez výměny je pořád překlep.
calls.length=0;
await fill('#od-datum','2026-04-30'); await fill('#od-voda','12');
await fill('#od-t1','1150'); await fill('#od-t2','5600');
await klik('#btn-odecet'); await pg.waitForTimeout(400);
check('dvojí zápis bez výměny pořád neprojde',!calls.some(c=>c.method==='POST'),
  calls.map(c=>c.method+' '+c.url).join(' | '));
await pg.evaluate(()=>zavriDlg());
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(800);

console.log('\n== 15e. vynechaný odečet se nepočítá jako nulová spotřeba ==');
// Reálný případ: v srpnu a září 2026 se odečetla jen voda a stav elektroměru
// se opsal z července, takže spotřeba vyšla 0 kWh. Prázdno musí zůstat
// prázdnem a další skutečný odečet se počítat proti poslednímu zapsanému.
await klik('.tab:text-is("Energie")'); await pg.waitForTimeout(400);
const odRadky3=async()=>pg.evaluate(()=>[...document.querySelectorAll('#energie-odecty tbody tr')]
  .map(tr=>({bunky:[...tr.children].map(td=>td.textContent.replace(/[\s  ]+/g,' ').trim()),
             tipy:[...tr.children].map(td=>td.getAttribute('title')||''),
             slito:[...tr.children].map(td=>!!td.querySelector('.vymena'))})));
const mesRadek3=async m=>pg.evaluate(mm=>{
  const tr=[...document.querySelectorAll('#energie-mesice tbody tr')]
    .find(x=>x.children[0].textContent.trim().startsWith(mm));
  return tr?{bunky:[...tr.children].map(td=>td.textContent.replace(/[\s  ]+/g,' ').trim()),
             vymena:!!tr.querySelector('.vymena')}:null;
},m);

await fill('#od-datum','2026-05-31');
await fill('#od-voda','20'); await fill('#od-t1','1200'); await fill('#od-t2','5800');
await klik('#btn-odecet'); await pg.waitForTimeout(500);
// Červen: odečetla se jen voda, elektroměr zůstal prázdný.
calls.length=0;
await fill('#od-datum','2026-06-30');
await fill('#od-voda','26'); await fill('#od-t1',''); await fill('#od-t2','');
await klik('#btn-odecet'); await pg.waitForTimeout(500);
const postJen=calls.find(c=>c.method==='POST'&&c.url.includes('energie_odecty'));
check('odečet jen s vodou projde',!!postJen,await pg.textContent('.toast').catch(()=>''));
check('nenaměřený stav se pošle jako prázdno, ne jako nula',
  postJen&&JSON.parse(postJen.body).t1===null&&JSON.parse(postJen.body).t2===null,
  postJen&&postJen.body);
let r3=await odRadky3();
check('vynechaná elektřina nedá nulovou spotřebu',
  r3[0].bunky[0].startsWith('2026-06-30')&&r3[0].bunky[5]==='—'&&r3[0].bunky[6]==='—',
  JSON.stringify(r3[0].bunky));
check('voda se počítá dál i bez elektřiny (6 m³)',r3[0].bunky[4]==='6',
  JSON.stringify(r3[0].bunky));

// Červenec: skutečný odečet. Počítá se proti květnu (1 200 / 5 800), ne proti
// prázdnému červnu — 1 300 − 1 200 = 100, 6 000 − 5 800 = 200.
await fill('#od-datum','2026-07-31');
await fill('#od-voda','32'); await fill('#od-t1','1300'); await fill('#od-t2','6000');
await klik('#btn-odecet'); await pg.waitForTimeout(500);
r3=await odRadky3();
check('další odečet se počítá proti poslednímu ZAPSANÉMU stavu (100 / 200)',
  r3[0].bunky[0].startsWith('2026-07-31')&&r3[0].bunky[5].startsWith('100')
  &&r3[0].bunky[6]==='200',JSON.stringify(r3[0].bunky));
check('u slité hodnoty je ⚠ a tooltip řekne odkud se měří',
  r3[0].slito[5]&&r3[0].tipy[5]==='spotřeba od 2026-05-31',
  JSON.stringify({slito:r3[0].slito[5],tip:r3[0].tipy[5]}));

const cerven=await mesRadek3('2026-06');
check('měsíc bez odečtu elektřiny nemá spotřebu',
  cerven&&cerven.bunky[2]==='—'&&cerven.bunky[3]==='—',JSON.stringify(cerven));
check('měsíc bez odečtu je označený ⚠',cerven&&cerven.vymena,JSON.stringify(cerven));
// Bez odečtu není náklad elektřiny jen měsíční fix — není vůbec. A dokud
// není celý náklad, nemá se co srovnávat se zálohou.
check('bez odečtu není náklad elektřiny ani rozdíl proti záloze',
  cerven&&cerven.bunky[4]==='—'&&cerven.bunky[8]==='—',JSON.stringify(cerven));
check('voda se vyúčtuje dál (6 × 90 = 540)',cerven&&cerven.bunky[5]==='540',
  JSON.stringify(cerven));
// V grafu musí takový měsíc zůstat prázdný, ne spadnout na nulu.
const grafCerven=await pg.evaluate(()=>{
  const c=[...document.querySelectorAll('#energie-graf .bar-col')][5];
  return [...c.querySelectorAll('.bar-par>div')].map(d=>d.title);
});
check('v grafu je měsíc bez odečtu prázdný, ne nulový',
  grafCerven.includes('06/2026: bez odečtu'),JSON.stringify(grafCerven));
const cervenec=await mesRadek3('2026-07');
check('slitý měsíc je taky označený ⚠ — není srovnatelný',
  cervenec&&cervenec.vymena&&cervenec.bunky[2]==='100',JSON.stringify(cervenec));
check('nikde negativní spotřeba',
  !r3.some(r=>r.bunky.slice(4,10).some(v=>v.startsWith('-')||v.startsWith('−'))),
  JSON.stringify(r3.map(r=>r.bunky)));
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(800);

console.log('\n== 16. spoření: čisté jmění, změna, projekce (#10) ==');
await klik('.tab:text-is("Spoření")'); await pg.waitForTimeout(300);
check('záložka Spoření je vidět',await pg.isVisible('#view-sporeni'));
check('prázdný stav se neukazuje',!(await pg.isVisible('#sporeni-empty')));

const sp=await pg.evaluate(()=>{
  const r={};
  for(const tr of document.querySelectorAll('#sporeni-table tbody tr')){
    const td=[...tr.children].map(x=>x.textContent.replace(/[\s\u00a0\u202f]+/g,' ').trim());
    r[td[0].slice(0,10)]=td;
  }
  return r;
});
// 2021-02: aktiva 110+210+310 = 630 000, závazky −2 085 000 → čisté −1 455 000
// změna proti lednu (−1 500 000) = +45 000; cashflow 5 000 + 45 000 − 20 000 = 30 000
check('aktiva jsou součet tří položek (630 000)',
  sp['2021-02-01'] && sp['2021-02-01'][4]==='630 000',JSON.stringify(sp['2021-02-01']));
check('závazky jsou součet tří položek (−2 085 000)',
  sp['2021-02-01'] && /^[-−]2 085 000$/.test(sp['2021-02-01'][8]),JSON.stringify(sp['2021-02-01']));
check('čisté jmění = aktiva + závazky (−1 455 000)',
  sp['2021-02-01'] && /^[-−]1 455 000$/.test(sp['2021-02-01'][9]),JSON.stringify(sp['2021-02-01']));
check('změna proti předchozímu snímku (+45 000)',
  sp['2021-02-01'] && sp['2021-02-01'][10]==='+45 000',JSON.stringify(sp['2021-02-01']));
check('cashflow = Áčkarta + Účet − rezerva (30 000)',
  sp['2021-02-01'] && sp['2021-02-01'][13]==='30 000',JSON.stringify(sp['2021-02-01']));
check('první snímek nemá s čím srovnat',
  sp['2021-01-01'] && sp['2021-01-01'][10]==='—',JSON.stringify(sp['2021-01-01']));
check('bez zůstatků zůstane cashflow prázdný, ne nula',
  sp['2021-01-01'] && sp['2021-01-01'][13]==='—',JSON.stringify(sp['2021-01-01']));
// Mezi únorem a dubnem chybí březen — změna je za dva měsíce a musí to být vidět.
check('díra v řadě je na řádku označená',
  sp['2021-04-01'] && /\u26a0/.test(sp['2021-04-01'][0]),JSON.stringify(sp['2021-04-01']));
check('měsíc bez díry označený není',
  sp['2021-02-01'] && !/\u26a0/.test(sp['2021-02-01'][0]),JSON.stringify(sp['2021-02-01']));
check('projekce je odlišená od skutečnosti',
  sp['2021-05-01'] && /odhad/.test(sp['2021-05-01'][0]),JSON.stringify(sp['2021-05-01']));
check('skutečné snímky se za projekci nevydávají',
  sp['2021-04-01'] && !/odhad/.test(sp['2021-04-01'][0]),JSON.stringify(sp['2021-04-01']));

// Stejná past jako u Energie: .badge se v .rok-table pod 640 px schovává a
// „tohle je odhad, ne skutečnost" je přesně to, co zmizet nesmí.
await pg.setViewportSize({width:390,height:800}); await pg.waitForTimeout(200);
check('označení projekce je vidět i na mobilu',
  await pg.isVisible('#sporeni-table .projekce'));
await pg.setViewportSize({width:1280,height:720}); await pg.waitForTimeout(200);

const skarty=txt(await pg.textContent('#sporeni-karty'));
// Karty berou poslední SKUTEČNÝ snímek (2021-04), ne projekci (2021-05).
check('karta čistého jmění bere poslední skutečný snímek',
  skarty.includes('2021-04-01')&&skarty.includes('1 410 000'),skarty);
check('karta nepočítá s projekcí',!skarty.includes('2021-05-01'),skarty);
check('karta spoření sečte aktiva (660 000)',skarty.includes('660 000 Kč'),skarty);
check('karta závazků ukazuje kladné číslo (2 070 000)',skarty.includes('2 070 000 Kč'),skarty);

const graf=await pg.evaluate(()=>{
  const sv=document.querySelector('#sporeni-graf svg');
  if(!sv)return null;
  return [...sv.querySelectorAll('polyline')].map(p=>({
    body:p.getAttribute('points').trim().split(/\s+/).length,
    carkovana:!!p.getAttribute('stroke-dasharray')}));
});
check('graf je spojnice, ne sloupce',graf&&graf.length===2,JSON.stringify(graf));
check('skutečnost je plná čára přes tři body',
  graf&&graf[0].body===3&&!graf[0].carkovana,JSON.stringify(graf));
// Projekce musí začít v posledním skutečném bodě, jinak je v čáře díra.
check('projekce je čárkovaná a navazuje na skutečnost',
  graf&&graf[1].body===2&&graf[1].carkovana,JSON.stringify(graf));

console.log('\n== 17. převody mezi peněženkami (#11) ==');
await klik('.tab:text-is("Přehled")'); await pg.waitForTimeout(300);
const pr=await pg.evaluate(()=>{
  const c=s=>{const t=(document.getElementById(s)||{}).textContent||'';
    const v=t.replace(/[^\d-]/g,'');return v?parseInt(v,10):null;};
  return {vydaje:c('sum-vydaje'),prijmy:c('sum-prijmy'),zustatek:c('sum-zustatek'),
          mand:(document.getElementById('sum-vydaje-mand')||{}).textContent||''};
});
// Skutečné výdaje měsíce jsou 1 200 + 800. Odchozí noha převodu (2 000) se
// nepočítá — kdyby ano, vyšlo by 4 000 a podíl mandatorních by spadl na půlku.
check('odchozí noha převodu není výdaj (2 000, ne 4 000)',pr.vydaje===2000,JSON.stringify(pr));
// Příjem měsíce je mzda 90 000. Příchozí noha (2 000) není příjem domácnosti.
check('příchozí noha převodu není příjem (93 000, ne 95 000)',pr.prijmy===93000,JSON.stringify(pr));
// Zůstatek naopak obě nohy počítá: 10 000 + 90 000 − 1 200 − 800 − 2 000 + 2 000.
check('zůstatek obě nohy započítá (101 000)',pr.zustatek===101000,JSON.stringify(pr));
// 800 z 2 000 je 40 %; se započítaným převodem by to bylo 20 %.
check('podíl mandatorních se počítá z výdajů bez převodů (40 %)',
  /40 % výdajů/.test(pr.mand),pr.mand);

await klik('.tab:text-is("Rok")'); await pg.waitForTimeout(400);
const rokPrevod=await pg.evaluate(()=>{
  const tr=document.querySelector('#rok-table tr.soucet');
  return tr?[...tr.children].map(x=>x.textContent.replace(/[\s\u00a0\u202f]+/g,' ').trim()):null;
});
// Buňka aktuálního měsíce: sloupec 0 je kategorie, pak 12× dvojice plán|skut.
// 90 000 − 1 200 − 800 = 88 000. S převodem by to bylo 86 000 a v rozpadu po
// kategoriích by u Ostatni seděly 2 000 navíc; obě nohy by se v součtu
// vyrušily, takže na celkovém čísle by to nebylo vidět.
const mIdx=new Date().getMonth();
check('matice Rok převod ignoruje (91 000 za aktuální měsíc)',
  rokPrevod&&rokPrevod[2+2*mIdx]==='91 000',JSON.stringify(rokPrevod&&rokPrevod[2+2*mIdx]));
const katOstatni=await pg.evaluate(()=>{
  for(const tr of document.querySelectorAll('#rok-table tbody tr')){
    if(tr.children[0].textContent.includes('Ostatni'))
      return [...tr.children].map(x=>x.textContent.replace(/[\s\u00a0\u202f]+/g,' ').trim());
  }
  return null;
});
check('kategorie převodu nesebrala jeho částku',
  katOstatni&&!katOstatni.some(v=>v==='-2 800'||v==='−2 800'),JSON.stringify(katOstatni));

// Zápis převodu: dvě nohy, jedna skupina, obě bez kategorie.
await klik('.tab:text-is("Peněženky")'); await pg.waitForTimeout(300);
calls.length=0;
await vyber('#pr-z','1'); await vyber('#pr-do','2');
await fill('#pr-castka','1500'); await fill('#pr-datum',d(9));
await fill('#pr-pozn','test převod');
await klik('#btn-prevod'); await pg.waitForTimeout(500);
const postPr=calls.find(c=>c.method==='POST'&&c.url.includes('/rest/v1/zaznamy'));
const telo=postPr?JSON.parse(postPr.body):null;
check('převod posílá dvě nohy najednou',Array.isArray(telo)&&telo.length===2,JSON.stringify(telo));
check('nohy mají opačný typ',telo&&telo[0].typ==='vydaj'&&telo[1].typ==='prijem',JSON.stringify(telo));
check('nohy jsou na různých peněženkách',telo&&telo[0].penezenka_id===1&&telo[1].penezenka_id===2,
  JSON.stringify(telo));
check('nohy sdílí jednu skupinu',telo&&telo[0].prevod_skupina&&telo[0].prevod_skupina===telo[1].prevod_skupina,
  JSON.stringify(telo));
check('převod nedostane kategorii',telo&&telo[0].kategorie_id===null&&telo[1].kategorie_id===null,
  JSON.stringify(telo));

// Pojistky ve formuláři. Stejná peněženka na obou stranách není převod.
calls.length=0;
await vyber('#pr-do','1'); await fill('#pr-castka','100');
await klik('#btn-prevod'); await pg.waitForTimeout(300);
check('převod na sebe sama neprojde',
  !calls.some(c=>c.method==='POST'),calls.map(c=>c.method+' '+c.url).join(' | '));
await vyber('#pr-do','2'); await fill('#pr-castka','-50');
await klik('#btn-prevod'); await pg.waitForTimeout(300);
check('záporná částka neprojde',
  !calls.some(c=>c.method==='POST'),calls.map(c=>c.method+' '+c.url).join(' | '));
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(800);

console.log('\n== 18. typ kategorie: příjem / výdaj / obojí ==');
await klik('.tab:text-is("Osnova")'); await pg.waitForTimeout(300);
const volbyTyp=await pg.evaluate(()=>[...document.querySelectorAll('#o-typ option')]
  .map(o=>[o.value,o.textContent.trim()]));
check('typ nabízí tři možnosti včetně obojího',
  JSON.stringify(volbyTyp)===JSON.stringify([['vydaj','Výdaj'],['prijem','Příjem'],['obe','Příjem i výdaj']]),
  JSON.stringify(volbyTyp));
const strom=txt(await pg.textContent('#cat-tree'));
check('obojí má v osnově vlastní odznak',strom.includes('příjem i výdaj'),strom);

// Jádro věci: kategorie s typem „obojí" se musí nabídnout u obou směrů.
await klik('.tab:text-is("Záznamy")'); await pg.waitForTimeout(300);
const nabidka=async typ=>{
  await vyber('#z-typ',typ); await pg.waitForTimeout(200);
  return pg.evaluate(()=>[...document.querySelectorAll('#z-kategorie option, #z-kategorie optgroup')]
    .map(o=>o.label||o.textContent.trim()));
};
const uVydaje=await nabidka('vydaj'), uPrijmu=await nabidka('prijem');
check('obojí se nabízí u výdaje',uVydaje.includes('Sporeni'),JSON.stringify(uVydaje));
check('obojí se nabízí i u příjmu',uPrijmu.includes('Sporeni'),JSON.stringify(uPrijmu));
// A čistě výdajová kategorie se u příjmu nabízet pořád nesmí.
check('výdajová kategorie zůstává jen u výdaje',
  uVydaje.includes('Ostatni')&&!uPrijmu.includes('Ostatni'),
  JSON.stringify({uVydaje,uPrijmu}));
check('příjmová kategorie zůstává jen u příjmu',
  uPrijmu.some(x=>x.includes('Mzda'))&&!uVydaje.some(x=>x.includes('Mzda')),
  JSON.stringify({uVydaje,uPrijmu}));

// Bez editace by typ šlo nastavit jen při zakládání a všechny kategorie
// už existují — nová volba by byla k ničemu.
await klik('.tab:text-is("Osnova")'); await pg.waitForTimeout(300);
calls.length=0;
await klik('#cat-tree .cat-item.top:has-text("Ostatni") .edit-btn'); await pg.waitForTimeout(300);
check('úprava předvyplní název',(await hodnota('#o-nazev'))==='Ostatni');
check('úprava předvyplní typ',(await hodnota('#o-typ'))==='vydaj');
check('úroveň se při úpravě nedá přepnout',await pg.isDisabled('#o-uroven'));
await vyber('#o-typ','obe');
await klik('#btn-osnova'); await pg.waitForTimeout(500);
const patchO=calls.find(c=>c.method==='PATCH'&&c.url.includes('/rest/v1/osnova'));
check('uložení pošle PATCH s novým typem',
  patchO&&JSON.parse(patchO.body).typ==='obe',patchO?patchO.body:'žádný PATCH');
check('po uložení se formulář vrátí do režimu přidání',
  (await hodnota('#o-nazev'))===''&&!(await pg.isDisabled('#o-uroven')));
await klik('.tab:text-is("Záznamy")'); await pg.waitForTimeout(300);
check('změna typu se hned projeví v nabídce',
  (await nabidka('prijem')).includes('Ostatni'));

await klik('.tab:text-is("Osnova")'); await pg.waitForTimeout(300);
await klik('#cat-tree .cat-item.top:has-text("Mzda") .edit-btn'); await pg.waitForTimeout(300);
calls.length=0;
await klik('#btn-cancel-osnova'); await pg.waitForTimeout(300);
check('zrušení úprav nic neuloží',!calls.some(c=>c.method==='PATCH'));
check('zrušení uklidí formulář',
  (await hodnota('#o-nazev'))===''&&!(await pg.isDisabled('#o-uroven')));
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(800);

console.log('\n== 19. souhrn za každý rok (#graf v Přehledu) ==');
await klik('.tab:text-is("Přehled")'); await pg.waitForTimeout(400);
const ro=await pg.evaluate(()=>[...document.querySelectorAll('#roky-chart .bar-col')].map(c=>({
  rok:c.querySelector('.bar-col-label').textContent.trim(),
  saldo:c.querySelector('.bar-col-val').textContent.trim(),
  popis:(c.getAttribute('title')||'').replace(/[\s\u00a0\u202f]+/g,' '),
  neuplny:c.classList.contains('neuplny'),
  bary:[...c.querySelectorAll('.bar-par>div')].length})));
// Mock má data jen v letošním a příštím měsíci téhož roku, takže sloupec je jeden.
check('sloupec za každý rok s daty',ro.length===1,JSON.stringify(ro));
check('dva bary na rok — příjmy a výdaje',ro[0]&&ro[0].bary===2,JSON.stringify(ro));
// Příjmy 90 000, výdaje 1 200 + 800 + 4 000 (jiný měsíc téhož roku) = 6 000.
// Převod (2 000 ven i dovnitř) se nepočítá, plán taky ne.
check('saldo je příjmy − výdaje bez plánu a převodů (+87k)',
  ro[0]&&ro[0].saldo==='+87k',JSON.stringify(ro));
check('popisek nese obě čísla',
  ro[0]&&/93 000/.test(ro[0].popis)&&/6 000/.test(ro[0].popis),ro[0]&&ro[0].popis);
// Letošek ještě neskončil, takže se s hotovými roky srovnávat nedá.
check('běžící rok je označený jako neúplný',ro[0]&&ro[0].neuplny,JSON.stringify(ro));
check('neúplný rok nese značku v popisku',ro[0]&&/\u26a0/.test(ro[0].rok),JSON.stringify(ro));

console.log('\n== 20. Rok: třetí tabulka přes všechny roky ==');
await klik('.tab:text-is("Rok")'); await pg.waitForTimeout(500);
check('tabulka všech let je vidět',await pg.isVisible('#roky-kat-blok'));
const vr=async()=>pg.evaluate(()=>{
  const cis=t=>{const v=t.replace(/[^\d+-]/g,'');return v?parseInt(v,10):0;};
  const o={};
  for(const tr of document.querySelectorAll('#roky-kat-table tbody tr')){
    const td=[...tr.children].map(x=>x.textContent.trim());
    o[td[0].replace(/[▸▾↳]/g,'').replace(/výdaj|příjem i výdaj|příjem/,'').trim()]=td.slice(1).map(cis);
  }
  const hl=[...document.querySelectorAll('#roky-kat-table th.mesic')].map(t=>t.textContent.trim());
  return {radky:o,hlavicka:hl};
});
const vsechny=await vr();
check('sloupec na každý rok s daty',vsechny.hlavicka.length===1,JSON.stringify(vsechny.hlavicka));
check('běžící rok je i tady označený',/\u26a0/.test(vsechny.hlavicka[0]),JSON.stringify(vsechny.hlavicka));

// Nezávislá kontrola: roční sloupec musí dát totéž co sloupec „Rok" ze
// souhrnné tabulky nad ním. Obě se počítají zvlášť, tak ať se shodnou.
const zeSouhrnu=await pg.evaluate(()=>{
  const cis=t=>{const v=t.replace(/[^\d+-]/g,'');return v?parseInt(v,10):0;};
  const o={};
  for(const tr of document.querySelectorAll('#rok-souhrn tbody tr')){
    const td=[...tr.children].map(x=>x.textContent.trim());
    // 7 skupin × 3 sloupce; Rok je poslední trojice, skutečnost je prostřední
    o[td[0].replace(/[▸▾↳]/g,'').replace(/výdaj|příjem i výdaj|příjem/,'').trim()]=cis(td[1+6*3+1]);
  }
  return o;
});
const neshody=Object.entries(vsechny.radky)
  .filter(([k,v])=>zeSouhrnu[k]!==undefined&&zeSouhrnu[k]!==v[0]);
check('roční součty sedí na souhrnnou tabulku',neshody.length===0,
  JSON.stringify({neshody,vsechny:vsechny.radky,zeSouhrnu}));
check('má se co srovnávat',Object.keys(vsechny.radky).length>=3,JSON.stringify(vsechny.radky));

// Rozbalení kategorie platí pro všechny tři tabulky naráz.
const pred=Object.keys((await vr()).radky).length;
await klik('#rok-table tbody tr.rozbalitelna'); await pg.waitForTimeout(400);
const po=Object.keys((await vr()).radky).length;
check('rozbalení v matici rozbalí i tabulku let',po===pred+1,`${pred} → ${po}`);
await klik('#rok-table tbody tr.rozbalitelna'); await pg.waitForTimeout(400);

// Přepínač roku se téhle tabulky netýká — je to pohled napříč lety.
await klik('#view-rok .month-nav button:first-child'); await pg.waitForTimeout(400);
check('prázdný rok tabulku let neschová',await pg.isVisible('#roky-kat-blok'));
const poPrepnuti=await vr();
check('přepnutí roku čísla nezmění',
  JSON.stringify(poPrepnuti.radky)===JSON.stringify(vsechny.radky),
  JSON.stringify({pred:vsechny.radky,po:poPrepnuti.radky}));
await klik('#view-rok .month-nav button:last-child'); await pg.waitForTimeout(400);

console.log('\n== 21. nic nepřetéká do strany (mobil) ==');
// Hlavička se na telefon nevešla a posouvala do strany celou stránku, ne jen
// sebe — tabulky i grafy mají vlastní posuvník, takže ven nic lézt nemá.
const ZALOZKY=['Přehled','Rok','Záznamy','Peněženky','Osnova','Energie','Spoření','Plán'];
for(const sirka of [320,390]){
  await pg.setViewportSize({width:sirka,height:800}); await pg.waitForTimeout(250);
  const pretekaji=[];
  for(const z of ZALOZKY){
    await klik(`.tab:text-is("${z}")`); await pg.waitForTimeout(250);
    const p=await pg.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    if(p>0)pretekaji.push(`${z}: +${p}px`);
  }
  check(`na ${sirka} px se stránka neposouvá do strany`,pretekaji.length===0,pretekaji.join(', '));
}
await pg.setViewportSize({width:390,height:800}); await pg.waitForTimeout(250);
check('na mobilu je zkrácený název',
  (await pg.isVisible('.logo-kratky'))&&!(await pg.isVisible('.logo-dlouhy')));
await pg.setViewportSize({width:1280,height:720}); await pg.waitForTimeout(250);
check('na širokém displeji je celý název',
  (await pg.isVisible('.logo-dlouhy'))&&!(await pg.isVisible('.logo-kratky')));
await klik('.tab:text-is("Přehled")'); await pg.waitForTimeout(300);

console.log('\n== 22. skryté peněženky a zůstatky po letech ==');
await klik('.tab:text-is("Peněženky")'); await pg.waitForTimeout(400);
const vSeznamu=await pg.evaluate(()=>[...document.querySelectorAll('#penezenky-list .wallet-name')]
  .map(e=>e.textContent.trim()));
check('administrace ukazuje i skryté',vSeznamu.length===3,JSON.stringify(vSeznamu));
check('skrytá je v seznamu odlišená',
  (await pg.locator('#penezenky-list .wallet-list-item.skryta').count())===1);
const vTabulce=await pg.evaluate(()=>[...document.querySelectorAll('#zustatky-table tbody tr:not(.soucet) .kat')]
  .map(e=>e.textContent.trim()));
check('prázdná skrytá peněženka v zůstatcích není',vTabulce.length===2,JSON.stringify(vTabulce));

await klik('.tab:text-is("Záznamy")'); await pg.waitForTimeout(300);
const nabidkaP=await pg.evaluate(()=>[...document.querySelectorAll('#z-penezenka option')].map(o=>o.textContent.trim()));
check('skrytá se nenabízí při zápisu',!nabidkaP.some(x=>x.includes('Stravenka')),JSON.stringify(nabidkaP));
await klik('.tab:text-is("Peněženky")'); await pg.waitForTimeout(300);
const nabidkaPrevod=await pg.evaluate(()=>[...document.querySelectorAll('#pr-z option')].map(o=>o.textContent.trim()));
check('skrytá se nenabízí ani u převodu',!nabidkaPrevod.some(x=>x.includes('Stravenka')),
  JSON.stringify(nabidkaPrevod));

// Přepínač v administraci
calls.length=0;
await klik('#penezenky-list .wallet-list-item:nth-child(2) .skryt-btn'); await pg.waitForTimeout(400);
const patchSk=calls.find(c=>c.method==='PATCH'&&c.url.includes('/rest/v1/penezenky'));
check('přepínač pošle PATCH se skryta',patchSk&&JSON.parse(patchSk.body).skryta===true,
  patchSk?patchSk.body:'žádný PATCH');
// Dlaždice v Přehledu: podtitulek je stav k 1. 1. zvoleného roku, ne kotva
// peněženky z roku 2015. Mock má všechny záznamy v letošku, takže se oboje
// shoduje — kontroluje se popisek a to, že se číslo mění s přepnutím roku.
await klik('.tab:text-is("Přehled")'); await pg.waitForTimeout(300);
const dlazdice=async()=>pg.evaluate(()=>[...document.querySelectorAll('#prehled-wallets .wallet-preview')]
  .map(e=>({nazev:e.querySelector('.wallet-preview-name').textContent.trim(),
            poc:e.querySelector('.wallet-preview-init').textContent.replace(/[\s\u00a0\u202f]+/g,' ').trim()})));
const dl=await dlazdice();
check('dlaždice ukazuje počáteční stav k 1. 1. zvoleného roku',
  dl.length&&/^k 1\. 1\. \d{4}: /.test(dl[0].poc),JSON.stringify(dl));
// Všechny záznamy v mocku jsou z letoška, takže všechny peněženky letos
// „vznikly" — kotva (10 000) se ukázat nesmí, na začátku roku nic neměly.
check('peněženka vzniklá v tomto roce začíná na nule',
  dl.every(d=>/: 0 Kč$/.test(d.poc)),JSON.stringify(dl));
// A naopak: jakmile má peněženka záznam z dřívějška, počítá se kotva i s ním.
const sLonskym=await pg.evaluate(()=>{
  const r=(new Date().getFullYear()-1)+'-06-10';
  zaznamy.push({id:99901,datum:r,castka:'4000.00',typ:'vydaj',typ_polozky:'skutecnost',
    kategorie_id:null,kde:'Loni',poznamka:null,penezenka_id:1});
  renderPrehled();
  const e=[...document.querySelectorAll('#prehled-wallets .wallet-preview')]
    .find(x=>x.querySelector('.wallet-preview-name').textContent.includes('Ucet'));
  const v=e.querySelector('.wallet-preview-init').textContent.replace(/[\s\u00a0\u202f]+/g,' ');
  zaznamy=zaznamy.filter(z=>z.id!==99901); renderPrehled();
  return v;
});
// kotva 10 000 − 4 000 z loňska
check('se starším záznamem se počítá kotva mínus pohyby do konce loňska',
  sLonskym.endsWith(': 6 000 Kč'),sLonskym);
await klik('.tab:text-is("Peněženky")'); await pg.waitForTimeout(300);
check('skrytá zmizí z přehledu',await pg.evaluate(()=>
  ![...document.querySelectorAll('#prehled-wallets .wallet-preview-name')].some(e=>e.textContent.includes('Kreditka'))));
await klik('#penezenky-list .wallet-list-item:nth-child(2) .skryt-btn'); await pg.waitForTimeout(400);

// Záznam na skryté peněžence nesmí při úpravě přijít o peněženku.
await klik('.tab:text-is("Záznamy")'); await pg.waitForTimeout(300);
// Konkrétní záznam, ne „první řádek" — ten se řadí podle data a mohl by to
// být jiný, než na kterém jsme peněženku přehodili.
await pg.evaluate(()=>{const z=zaznamy.find(z=>z.id===101);z.penezenka_id=3;editZaznam(101);});
await pg.waitForTimeout(400);
check('skrytá peněženka upravovaného záznamu se do nabídky doplní',
  (await hodnota('#z-penezenka'))==='3',
  JSON.stringify(await pg.evaluate(()=>[...document.querySelectorAll('#z-penezenka option')].map(o=>o.value+':'+o.textContent))));
await pg.evaluate(()=>zavriDlg());
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(800);

// Zůstatky po letech
await klik('.tab:text-is("Peněženky")'); await pg.waitForTimeout(400);
const zuRok=async()=>pg.evaluate(()=>{
  const cis=t=>{const v=t.textContent.replace(/[^\d+-]/g,'');return v?parseInt(v,10):0;};
  const tr=[...document.querySelectorAll('#zustatky-table tbody tr:not(.soucet)')];
  const hl=[...document.querySelectorAll('#zustatky-table thead th')].map(e=>e.textContent.trim());
  return {hlavicka:hl,radky:tr.map(r=>({nazev:r.children[0].textContent.trim(),
    poc:cis(r.children[1]),pohyby:cis(r.children[2]),zust:cis(r.children[3])}))};
});
const zuLetos=await zuRok();
check('zůstatek = počáteční + pohyby',zuLetos.radky.every(r=>r.zust===r.poc+r.pohyby),
  JSON.stringify(zuLetos.radky));
// Tabulka je za celou historii, ne za rok — musí sedět na Pivot a nesmí se
// měnit s přepínačem měsíce. Rozpad po letech je v dlaždicích v Přehledu.
check('zůstatek Účtu sedí na dlaždici v Přehledu',await pg.evaluate(()=>{
  const cis=t=>{const v=t.replace(/[^\d-]/g,'');return v?parseInt(v,10):0;};
  const dl=[...document.querySelectorAll('#prehled-wallets .wallet-preview')]
    .find(e=>e.querySelector('.wallet-preview-name').textContent.includes('Ucet'));
  const tr=[...document.querySelectorAll('#zustatky-table tbody tr:not(.soucet)')]
    .find(r=>r.children[0].textContent.includes('Ucet'));
  return dl&&tr&&cis(dl.querySelector('.wallet-preview-balance').textContent)===cis(tr.children[3].textContent);
}));
await klik('header .month-nav button:first-child'); await pg.waitForTimeout(400);
const jinyMesic=await zuRok();
check('přepnutí měsíce zůstatky nemění',
  JSON.stringify(jinyMesic.radky)===JSON.stringify(zuLetos.radky),
  JSON.stringify({pred:zuLetos.radky,po:jinyMesic.radky}));
await klik('header .month-nav button:last-child'); await pg.waitForTimeout(400);

console.log('\n== 23. rozpad částky z Přehledu na záznamy ==');
await klik('.tab:text-is("Přehled")'); await pg.waitForTimeout(400);
check('rozpad je zavřený',!(await pg.isVisible('#rozpad')));
// Kategorie Jídlo: skutečnost 1 200 (Albert), plán 5 000.
const radekJidlo='#plan-vs-real-table tr:has-text("Jídlo")';
check('klikatelná je jen buňka, kde je co ukázat',
  (await pg.locator(radekJidlo+' .klik').count())===2);
await klik(radekJidlo+' td:nth-child(3)'); await pg.waitForTimeout(300);
check('rozpad se otevřel',await pg.isVisible('#rozpad'));
check('nadpis je kategorie',(await pg.textContent('#rozpad-titulek')).includes('Jídlo'));
check('podtitulek říká skutečnost a počet',
  /skutečnost · .+ · 1 položka/.test(txt(await pg.textContent('#rozpad-podtitulek'))),
  await pg.textContent('#rozpad-podtitulek'));
check('součet sedí na číslo v tabulce',
  txt(await pg.textContent('#rozpad-soucet')).includes('1 200'),
  await pg.textContent('#rozpad-soucet'));
const rozTelo=txt(await pg.textContent('#rozpad-telo'));
check('řádek nese kde i poznámku',rozTelo.includes('Albert & <i>spol</i>')&&rozTelo.includes('pozn "x" <hr>'),rozTelo);
check('HTML ze záznamu se nevyrenderuje',(await pg.locator('#rozpad-telo i').count())===0);
check('v řádku je podkategorie a peněženka',rozTelo.includes('Albert "levně"')&&rozTelo.includes('Ucet'),rozTelo);
check('jeden řádek, ne víc',(await pg.locator('#rozpad-radek, #rozpad-telo .rozpad-radek').count())===1);

await pg.keyboard.press('Escape'); await pg.waitForTimeout(250);
check('Escape rozpad zavře',!(await pg.isVisible('#rozpad')));

// Plán téže kategorie — jiný seznam, jiný součet.
await klik(radekJidlo+' td:nth-child(2)'); await pg.waitForTimeout(300);
check('rozpad plánu ukáže plánovanou částku',
  txt(await pg.textContent('#rozpad-soucet')).includes('5 000')
  &&/plán ·/.test(await pg.textContent('#rozpad-podtitulek')),
  txt(await pg.textContent('#rozpad-soucet'))+' | '+await pg.textContent('#rozpad-podtitulek'));
await klik('#rozpad',{position:{x:5,y:5}}); await pg.waitForTimeout(250);
check('klik mimo okno ho zavře',!(await pg.isVisible('#rozpad')));

// Mzda: příjem 90 000 skutečnost — jiné znaménko i barva.
await klik('#plan-vs-real-table tr:has-text("Mzda") td:nth-child(3)'); await pg.waitForTimeout(300);
check('u příjmu je součet zelený',
  (await pg.evaluate(()=>document.getElementById('rozpad-soucet').style.color)).includes('green'),
  await pg.evaluate(()=>document.getElementById('rozpad-soucet').style.color));
await klik('.rozpad-hlava .edit-btn'); await pg.waitForTimeout(250);
check('křížek rozpad zavře',!(await pg.isVisible('#rozpad')));

console.log('\n== 24. stránkování: víc záznamů než strop PostgRESTu ==');
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
const zaznamyGET=calls.filter(c=>c.method==='GET'&&c.url.includes('/rest/v1/zaznamy'));
const pocetniDotaz=zaznamyGET.filter(c=>(c.prefer||'').includes('count=exact'));
const strankyZaznamu=zaznamyGET.filter(c=>c.url.includes('offset='));
check('nejdřív se zjistí počet řádků',pocetniDotaz.length===1,
  JSON.stringify(zaznamyGET.map(c=>c.prefer)));
check('dotahovalo se po stránkách',strankyZaznamu.length===Math.ceil(POCET/MAX_ROWS),
  strankyZaznamu.length+' stránek');
check('každá stránka má limit i offset',
  strankyZaznamu.every(c=>c.url.includes('limit=')&&c.url.includes('offset=')),
  strankyZaznamu.map(c=>c.url).join(' | '));
check('řazení je deterministické (rozstřel podle id)',
  strankyZaznamu.every(c=>/order=datum\.desc,id\.desc/.test(decodeURIComponent(c.url))),
  strankyZaznamu.map(c=>c.url).join(' | '));
// Souběžnost se musí měřit ve stránce, ne v mocku: Playwright obsluhuje
// route jednu po druhé, takže odpovědi chodí sériově, ať appka dělá cokoli.
// Co nás zajímá, je jestli appka pošle další dotaz, než jí dorazí předchozí
// odpověď — a to je vidět na překryvu intervalů jejích vlastních fetchů.
await pg.addInitScript(()=>{
  window.__fetchLog=[];
  const orig=window.fetch;
  window.fetch=async(...a)=>{
    const i=window.__fetchLog.push({url:String(a[0]),od:performance.now(),do:null})-1;
    try{return await orig(...a);}finally{window.__fetchLog[i].do=performance.now();}
  };
});
zpomal=true;
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(2000);
zpomal=false;
const log=(await pg.evaluate(()=>window.__fetchLog))
  .filter(f=>f.url.includes('/rest/v1/zaznamy')&&f.url.includes('offset=')&&f.do!==null);
const soubezne=Math.max(...log.map(f=>log.filter(g=>g.od<=f.od&&f.od<g.do).length),0);
check('stránky se stahují souběžně, ne jedna po druhé',soubezne>=2,
  `stránek ${log.length}, nejvíc souběžně ${soubezne}`);
check('načteno i při souběžném stahování všech '+POCET,
  (await pg.evaluate(()=>zaznamy.length))===POCET);

// Záložní cesta. Content-Range není mezi bezpečnými CORS hlavičkami, takže ji
// stačí neexponovat a appka počet nedostane. Nesmí z toho vypadnout míň dat —
// jen se to stáhne postaru, jedna stránka po druhé.
skryjPocet=true; calls.length=0;
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(1500);
skryjPocet=false;
check('bez hlavičky s počtem se stáhne všechno stejně',
  (await pg.evaluate(()=>zaznamy.length))===POCET);
const zaloha=(await pg.evaluate(()=>window.__fetchLog))
  .filter(f=>f.url.includes('/rest/v1/zaznamy')&&f.url.includes('offset=')&&f.do!==null);
check('záložní cesta jede sériově',
  Math.max(...zaloha.map(f=>zaloha.filter(g=>g.od<=f.od&&f.od<g.do).length),0)===1,
  JSON.stringify(zaloha.map(f=>[Math.round(f.od),Math.round(f.do)])));
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(1200);

// 2500 výdajů po 1 Kč z počátečního zůstatku 10 000
check('zůstatek počítá se všemi záznamy (7 500)',
  txt(await pg.textContent('#sum-zustatek')).includes('7 500'),
  await pg.textContent('#sum-zustatek'));
DB.zaznamy=puvodni;

console.log('\n== 25. zadávací dialogy ==');
// Formuláře už nestojí vedle obsahu, otevírá je tlačítko. Tady se testuje
// samotná mechanika — jinde si ji obálky v testu otevírají zkratkou.
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(800);
await pg.click('.tab:text-is("Záznamy")'); await pg.waitForTimeout(300);
check('formulář není vidět, dokud ho nikdo nevyvolá',
  !(await pg.isVisible('#dlg-zaznam')));
check('v hlavičce je tlačítko',await pg.isVisible('#view-zaznamy .list-head .btn'));
await pg.click('#view-zaznamy .list-head .btn'); await pg.waitForTimeout(300);
check('tlačítko dialog otevře',await pg.isVisible('#dlg-zaznam'));
check('kurzor skočí do částky',
  (await pg.evaluate(()=>document.activeElement&&document.activeElement.id))==='z-castka');
check('pozadí se pod dialogem nescrolluje',
  (await pg.evaluate(()=>document.body.style.overflow))==='hidden');
// Tabulka pod dialogem je nedosažitelná — proto si testy dialog zavírají.
check('dialog zakrývá obsah pod sebou',
  (await pg.evaluate(()=>{
    const d=document.querySelector('#dlg-zaznam');
    const r=d.getBoundingClientRect();
    return document.elementFromPoint(r.width/2,8)===d
        || d.contains(document.elementFromPoint(r.width/2,8));
  })));
await pg.keyboard.press('Escape'); await pg.waitForTimeout(250);
check('Escape dialog zavře',!(await pg.isVisible('#dlg-zaznam')));
check('scroll pozadí se vrátí',(await pg.evaluate(()=>document.body.style.overflow))==='');

await pg.click('#view-zaznamy .list-head .btn'); await pg.waitForTimeout(250);
await pg.click('#dlg-zaznam .dlg-x'); await pg.waitForTimeout(250);
check('✕ dialog zavře',!(await pg.isVisible('#dlg-zaznam')));
await pg.click('#view-zaznamy .list-head .btn'); await pg.waitForTimeout(250);
await pg.click('#dlg-zaznam',{position:{x:5,y:5}}); await pg.waitForTimeout(250);
check('klik mimo okno dialog zavře',!(await pg.isVisible('#dlg-zaznam')));

// Editace musí dialog otevřít sama — jinak by se předvyplnil formulář,
// který není vidět, a vypadalo by to, že ✎ nic neudělalo.
await pg.click('#zaznamy-table .edit-btn'); await pg.waitForTimeout(400);
check('✎ dialog otevře',await pg.isVisible('#dlg-zaznam'));
check('nadpis je v hlavě dialogu',
  (await pg.textContent('#dlg-zaznam .dlg-hlava .form-title')).includes('Upravit'));
check('je nabídnuté i zrušení',await pg.isVisible('#btn-cancel-zaznam'));
// A zavření rozkoukané editace ji musí zrušit. Kdyby editingZaznamId zůstalo
// nastavené, příští „Přidat" by přepsalo upravovaný řádek.
await pg.keyboard.press('Escape'); await pg.waitForTimeout(250);
await pg.click('#view-zaznamy .list-head .btn'); await pg.waitForTimeout(250);
check('zavření Escapem zruší editaci, dialog je zpátky v režimu zápisu',
  (await pg.textContent('#dlg-zaznam .dlg-hlava .form-title')).includes('Přidat')
  &&!(await pg.isVisible('#btn-cancel-zaznam')));
calls.length=0;
await pg.fill('#z-castka','4321'); await pg.fill('#z-datum',d(15));
await pg.click('#btn-zaznam'); await pg.waitForTimeout(600);
const postD=calls.find(c=>c.method==='POST'&&c.url.includes('zaznamy'));
check('po zrušené editaci vzniká nový záznam, ne PATCH',
  !!postD&&!calls.some(c=>c.method==='PATCH'),
  calls.map(c=>c.method+' '+c.url).join(' | '));
// Přidávání nechá dialog otevřený (zadává se po sobě víc řádků), uložená
// editace ho zavře.
check('po přidání zůstává dialog otevřený',await pg.isVisible('#dlg-zaznam'));
check('pole se vyprázdní pro další zápis',(await pg.inputValue('#z-castka'))==='');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
calls.length=0;
await pg.click('#zaznamy-table .edit-btn'); await pg.waitForTimeout(400);
await pg.fill('#z-castka','999');
await pg.click('#btn-zaznam'); await pg.waitForTimeout(600);
check('uložená editace dialog zavře',!(await pg.isVisible('#dlg-zaznam')),
  calls.map(c=>c.method+' '+c.url).join(' | '));

// Všechny zadávací formuláře jsou v dialogu a každý má své tlačítko.
const dlgy=await pg.evaluate(()=>[...document.querySelectorAll('.dlg-pozadi')].map(d=>({
  id:d.id,
  nadpis:!!d.querySelector('.dlg-hlava .form-title'),
  krizek:!!d.querySelector('.dlg-x'),
  otevreny:d.classList.contains('open')})));
check('v appce je šest zadávacích dialogů',dlgy.length===6,JSON.stringify(dlgy.map(x=>x.id)));
check('každý má nadpis i křížek',dlgy.every(x=>x.nadpis&&x.krizek),JSON.stringify(dlgy));
check('žádný nezůstal otevřený',dlgy.every(x=>!x.otevreny),JSON.stringify(dlgy));
const sirotci=await pg.evaluate(()=>
  [...document.querySelectorAll('.form-title')].filter(t=>!t.closest('.dlg-hlava')).length);
check('žádný formulář nezůstal mimo dialog',sirotci===0,String(sirotci));
for(const [zal,tl] of [['Energie',2],['Peněženky',2],['Osnova',1],['Záznamy',1]]){
  await pg.click(`.tab:text-is("${zal}")`); await pg.waitForTimeout(250);
  const n=await pg.evaluate(z=>document.querySelectorAll(
    '#view-'+z+' .list-head .btn').length,
    {'Energie':'energie','Peněženky':'penezenky','Osnova':'osnova','Záznamy':'zaznamy'}[zal]);
  check(`záložka ${zal} má ${tl} tlačítko/a pro zápis`,n===tl,String(n));
}
await pg.reload(); await pg.waitForSelector('main',{state:'visible'}); await pg.waitForTimeout(800);

console.log('\n== chyby v konzoli ==');
// 400 = záměrně špatné heslo v testu 2
const real=errors.filter(e=>!e.includes('net::ERR_')&&!e.includes('fonts.googleapis')
  &&!/Failed to load resource.*400/.test(e));
check('žádné JS chyby',real.length===0,real.join(' | '));

await b.close();
console.log('\n'+(fails.length?'SELHALO: '+fails.length+' → '+fails.join(', '):'VŠECHNY TESTY PROŠLY'));
process.exit(fails.length?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2)});
