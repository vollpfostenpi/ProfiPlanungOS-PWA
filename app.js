const $ = id => document.getElementById(id);
const fmt = (v,d=1) => Number.isFinite(Number(v)) ? Number(v).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
const money = v => `${fmt(v,0)} €`;
const clamp = (x,a,b) => Math.min(Math.max(Number(x)||0,a),b);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

const DEFAULT = {
  project:{name:"Neues Projekt",customer:"",locationName:"",latitude:52.69,longitude:7.29,aiEnabled:false},
  grid:{hakMode:"Ampere",hakValue:63,emsEnabled:false},
  economics:{gridPrice:0.35,feedIn:0.08,demandCharge:90,dieselPrice:1.70,thgRate:100,analysisYears:10,pvCapex:1100,pvOpexPct:0.015,batOpexPct:0.01,
    electricityPriceMode:"manual",electricityMarkup:0.20,fuelPriceMode:"manual",fuelType:"diesel",manualFuelPrice:1.70,fuelRadius:10,
    tankerkoenigKey:"",lastSpotEURPerKWh:null,lastFuelPrices:{diesel:null,e10:null,e5:null}},
  load:{points:[],source:"",resolutionHours:1},
  pv:{
    totalOverrideEnabled:false,totalOverride:0,specificYield:1000,performanceRatio:0.86,
    roofs:[{id:uuid(),name:"Dach 1",width:10,depth:6,tilt:35,azimuth:0,usableFactor:0.8,manualKwpEnabled:false,manualKwp:0}],
    fields:[],inverters:[]
  },
  battery:{
    objective:"Eigenverbrauch",kwh:0,kw:0,minSoc:10,eta:0.92,capexKWh:450,capexKW:200,
    arbitrageEnabled:false,arbLow:0.18,arbHigh:0.32,arbCycles:180,arbDeg:0.03,
    peakShavingEnabled:false,peakTargetKW:0
  },
  charging:{chargers:[],fleet:[]},
  forecast:{days:7,roofForecasts:{},totalKWh:0,hourly:[]},
  results:{}
};

let state = loadState();
let deferredPrompt = null;

function loadState(){
  try{
    const raw = localStorage.getItem("profiPlanungOS");
    if(!raw) return structuredClone(DEFAULT);
    const parsed = JSON.parse(raw);
    return deepMerge(structuredClone(DEFAULT),parsed);
  }catch(e){return structuredClone(DEFAULT)}
}
function deepMerge(base,extra){
  if(!extra || typeof extra!=="object") return base;
  for(const [k,v] of Object.entries(extra)){
    if(Array.isArray(v)) base[k]=v;
    else if(v && typeof v==="object") base[k]=deepMerge(base[k]||{},v);
    else base[k]=v;
  }
  return base;
}
function saveState(show=true){
  pullStaticInputs();
  localStorage.setItem("profiPlanungOS",JSON.stringify(state));
  if(show){$("saveStatus").textContent=`Gespeichert ${new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}`;setTimeout(()=>$("saveStatus").textContent="",2500)}
  refreshAll();
}
function hakKW(){
  return state.grid.hakMode==="kW" ? Number(state.grid.hakValue)||0 : (Number(state.grid.hakValue)||0)*400*1.732/1000;
}
function orientationFactor(tilt,az){
  const tiltPenalty = Math.max(0.65,1 - Math.abs((Number(tilt)||30)-32)*0.0045);
  const a=Math.abs(Number(az)||0);
  const azPenalty = Math.max(0.55,1 - a*0.0022);
  return tiltPenalty*azPenalty;
}
function roofKwp(roof){
  if(roof.manualKwpEnabled) return Number(roof.manualKwp)||0;
  return state.pv.fields.filter(f=>f.roofId===roof.id).reduce((s,f)=>s+(Number(f.moduleW)||0)*(Number(f.count)||0)/1000,0);
}
function pvTotalKWp(){
  if(state.pv.totalOverrideEnabled) return Number(state.pv.totalOverride)||0;
  return state.pv.roofs.reduce((s,r)=>s+roofKwp(r),0);
}
function annualPV(){
  const totalOverride = state.pv.totalOverrideEnabled;
  if(totalOverride){
    const avgFactor = state.pv.roofs.length ? state.pv.roofs.reduce((s,r)=>s+orientationFactor(r.tilt,r.azimuth),0)/state.pv.roofs.length : 1;
    return pvTotalKWp()*state.pv.specificYield*avgFactor;
  }
  return state.pv.roofs.reduce((s,r)=>s+roofKwp(r)*state.pv.specificYield*orientationFactor(r.tilt,r.azimuth),0);
}
function loadKPIs(){
  const pts=state.load.points||[];
  if(!pts.length) return {peak:0,p95:0,avg:0,energy:0};
  const vals=pts.map(p=>Number(p.kw)||0).filter(Number.isFinite).sort((a,b)=>a-b);
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
  const peak=vals[vals.length-1]||0;
  const p95=vals[Math.floor((vals.length-1)*.95)]||0;
  const dt=state.load.resolutionHours||inferResolutionHours(pts);
  const energy=vals.reduce((a,b)=>a+b,0)*dt;
  const spanDays = pts.length*dt/24;
  const annual = spanDays>330 ? energy : energy*(365/Math.max(spanDays,1));
  return {peak,p95,avg,energy:annual};
}
function inferResolutionHours(pts){
  if(pts.length<2) return 1;
  const a=new Date(pts[0].timestamp).getTime(), b=new Date(pts[1].timestamp).getTime();
  const h=Math.abs(b-a)/3600000;
  return h>0 && h<24 ? h : 1;
}
function chargerTotalKW(){return state.charging.chargers.reduce((s,c)=>s+(Number(c.kwEach)||0)*(Number(c.count)||0),0)}
function fleetEnergy(){return state.charging.fleet.reduce((s,f)=>s+(Number(f.count)||0)*(Number(f.kmYear)||0)*(Number(f.kwh100)||0)/100,0)}
function fleetCount(){return state.charging.fleet.reduce((s,f)=>s+(Number(f.count)||0),0)}
function fleetFuelLiters(){
  return state.charging.fleet.reduce((s,f)=>s+(Number(f.count)||0)*(Number(f.kmYear)||0)*(Number(f.l100)||0)/100,0)
}
function activeFuelPrice(fuelType){
  const e=state.economics;
  if(e.fuelPriceMode==="tankerkoenig"){
    const p=e.lastFuelPrices?.[fuelType||e.fuelType];
    if(Number.isFinite(Number(p))) return Number(p);
  }
  return Number(e.manualFuelPrice||e.dieselPrice||0);
}
function dieselBaselineCost(){
  return state.charging.fleet.reduce((s,f)=>{
    const liters=(Number(f.count)||0)*(Number(f.kmYear)||0)*(Number(f.l100)||0)/100;
    return s+liters*activeFuelPrice(f.fuelType||state.economics.fuelType);
  },0)
}
function evCost(){return fleetEnergy()*state.economics.gridPrice}
function arbitrageProfit(){
  if(!state.battery.arbitrageEnabled || state.battery.kwh<=0) return 0;
  const b=state.battery, spread=Math.max((b.arbHigh||0)-(b.arbLow||0),0);
  const usable=b.kwh*(1-b.minSoc/100);
  const discharge=usable*b.arbCycles;
  const throughput=usable*b.arbCycles*2;
  return Math.max(discharge*spread*b.eta-throughput*b.arbDeg,0);
}
function peakSaving(){
  const k=loadKPIs(), b=state.battery;
  if(!b.peakShavingEnabled || !k.peak || !b.kw) return 0;
  const target=b.peakTargetKW>0?b.peakTargetKW:k.p95*.9;
  const possible=Math.min(Math.max(k.peak-target,0),b.kw);
  return possible*state.economics.demandCharge;
}
function selfConsumptionEstimate(){
  const load=loadKPIs().energy, pv=annualPV(), bat=state.battery.kwh;
  if(load<=0 || pv<=0) return {direct:0,batShift:0,selfUsed:0,export:pv};
  const direct=Math.min(load,pv*.55);
  const unused=Math.max(pv-direct,0);
  const deficit=Math.max(load-direct,0);
  const batShift=Math.min(unused,deficit,bat*220)*state.battery.eta;
  const selfUsed=direct+batShift;
  return {direct,batShift,selfUsed,export:Math.max(pv-selfUsed,0)};
}
function economics(){
  const pv=annualPV(), load=loadKPIs().energy, sc=selfConsumptionEstimate();
  const baseline=load*state.economics.gridPrice;
  const withSystem=Math.max(load-sc.selfUsed,0)*state.economics.gridPrice - sc.export*state.economics.feedIn;
  const pvBenefit=Math.max(baseline-withSystem,0);
  const peak=peakSaving(), arb=arbitrageProfit();
  const thg=fleetCount()*state.economics.thgRate;
  const fuelSaving=Math.max(dieselBaselineCost()-evCost(),0);
  const pvCapex=pvTotalKWp()*state.economics.pvCapex;
  const batCapex=state.battery.kwh*state.battery.capexKWh+state.battery.kw*state.battery.capexKW;
  const capex=pvCapex+batCapex;
  const opex=pvCapex*state.economics.pvOpexPct+batCapex*state.economics.batOpexPct;
  const annualBenefit=pvBenefit+peak+arb+thg+fuelSaving-opex;
  const payback=annualBenefit>0?capex/annualBenefit:Infinity;
  let cf=-capex, ten=-capex, series=[{year:0,value:-capex}];
  for(let y=1;y<=state.economics.analysisYears;y++){
    const degradation=Math.pow(.995,y-1);
    cf += annualBenefit*degradation;
    if(y===10) ten=cf;
    series.push({year:y,value:cf});
  }
  if(state.economics.analysisYears<10) ten=series[series.length-1].value;
  return {baseline,withSystem,pvBenefit,peak,arb,thg,fuelSaving,capex,opex,annualBenefit,payback,tenYear:ten,series};
}

function setStaticInputs(){
  $("projectName").value=state.project.name;$("customer").value=state.project.customer;$("locationName").value=state.project.locationName;
  $("latitude").value=state.project.latitude;$("longitude").value=state.project.longitude;$("aiEnabled").checked=state.project.aiEnabled;
  $("hakMode").value=state.grid.hakMode;$("hakValue").value=state.grid.hakValue;$("emsEnabled").checked=state.grid.emsEnabled;
  $("gridPrice").value=state.economics.gridPrice;$("feedIn").value=state.economics.feedIn;$("demandCharge").value=state.economics.demandCharge;
  $("dieselPrice").value=state.economics.dieselPrice;$("thgRate").value=state.economics.thgRate;$("analysisYears").value=state.economics.analysisYears;
  $("electricityPriceMode").value=state.economics.electricityPriceMode||"manual";$("electricityMarkup").value=state.economics.electricityMarkup??0.20;
  $("fuelPriceMode").value=state.economics.fuelPriceMode||"manual";$("fuelType").value=state.economics.fuelType||"diesel";
  $("manualFuelPrice").value=state.economics.manualFuelPrice??state.economics.dieselPrice;$("fuelRadius").value=state.economics.fuelRadius||10;
  $("tankerkoenigKey").value=state.economics.tankerkoenigKey||"";
  $("pvTotalOverrideEnabled").checked=state.pv.totalOverrideEnabled;$("pvTotalOverride").value=state.pv.totalOverride;
  $("specificYield").value=state.pv.specificYield;$("performanceRatio").value=state.pv.performanceRatio;
  $("batteryObjective").value=state.battery.objective;$("batteryKWh").value=state.battery.kwh;$("batteryKW").value=state.battery.kw;
  $("batteryMinSOC").value=state.battery.minSoc;$("batteryEta").value=state.battery.eta;$("batteryCapexKWh").value=state.battery.capexKWh;$("batteryCapexKW").value=state.battery.capexKW;
  $("arbitrageEnabled").checked=state.battery.arbitrageEnabled;$("arbLow").value=state.battery.arbLow;$("arbHigh").value=state.battery.arbHigh;$("arbCycles").value=state.battery.arbCycles;$("arbDeg").value=state.battery.arbDeg;
  $("peakShavingEnabled").checked=state.battery.peakShavingEnabled;$("peakTargetKW").value=state.battery.peakTargetKW;
  $("forecastDays").value=state.forecast.days;$("pvCapex").value=state.economics.pvCapex;$("pvOpexPct").value=state.economics.pvOpexPct;$("batOpexPct").value=state.economics.batOpexPct;
}
function pullStaticInputs(){
  state.project={...state.project,name:$("projectName").value,customer:$("customer").value,locationName:$("locationName").value,
    latitude:Number($("latitude").value)||0,longitude:Number($("longitude").value)||0,aiEnabled:$("aiEnabled").checked};
  state.grid={hakMode:$("hakMode").value,hakValue:Number($("hakValue").value)||0,emsEnabled:$("emsEnabled").checked};
  Object.assign(state.economics,{gridPrice:Number($("gridPrice").value)||0,feedIn:Number($("feedIn").value)||0,demandCharge:Number($("demandCharge").value)||0,
    dieselPrice:Number($("dieselPrice").value)||0,thgRate:Number($("thgRate").value)||0,analysisYears:Number($("analysisYears").value)||10,
    pvCapex:Number($("pvCapex").value)||0,pvOpexPct:Number($("pvOpexPct").value)||0,batOpexPct:Number($("batOpexPct").value)||0,
    electricityPriceMode:$("electricityPriceMode").value,electricityMarkup:Number($("electricityMarkup").value)||0,
    fuelPriceMode:$("fuelPriceMode").value,fuelType:$("fuelType").value,manualFuelPrice:Number($("manualFuelPrice").value)||0,
    fuelRadius:Number($("fuelRadius").value)||10,tankerkoenigKey:$("tankerkoenigKey").value});
  Object.assign(state.pv,{totalOverrideEnabled:$("pvTotalOverrideEnabled").checked,totalOverride:Number($("pvTotalOverride").value)||0,
    specificYield:Number($("specificYield").value)||1000,performanceRatio:Number($("performanceRatio").value)||.86});
  Object.assign(state.battery,{objective:$("batteryObjective").value,kwh:Number($("batteryKWh").value)||0,kw:Number($("batteryKW").value)||0,minSoc:Number($("batteryMinSOC").value)||0,
    eta:Number($("batteryEta").value)||.92,capexKWh:Number($("batteryCapexKWh").value)||0,capexKW:Number($("batteryCapexKW").value)||0,
    arbitrageEnabled:$("arbitrageEnabled").checked,arbLow:Number($("arbLow").value)||0,arbHigh:Number($("arbHigh").value)||0,
    arbCycles:Number($("arbCycles").value)||0,arbDeg:Number($("arbDeg").value)||0,peakShavingEnabled:$("peakShavingEnabled").checked,peakTargetKW:Number($("peakTargetKW").value)||0});
  state.forecast.days=Number($("forecastDays").value)||7;
}

function showTab(name){
  document.querySelectorAll(".tabpane").forEach(x=>x.classList.toggle("active",x.id===name));
  document.querySelectorAll(".tabs button").forEach(x=>x.classList.toggle("active",x.dataset.tab===name));
  if(name==="bericht") refreshReport();
}
$("tabs").addEventListener("click",e=>{if(e.target.dataset.tab)showTab(e.target.dataset.tab)});

function renderRoofs(){
  const box=$("roofsList");box.innerHTML="";
  state.pv.roofs.forEach((r,i)=>{
    const el=document.createElement("div");el.className="entity";
    el.innerHTML=`<div class="entity-head"><strong>${escapeHtml(r.name||`Dach ${i+1}`)}</strong><button class="danger" data-del-roof="${r.id}">Löschen</button></div>
    <div class="entity-grid">
      <label>Name<input data-roof="${r.id}" data-k="name" value="${escapeAttr(r.name)}"></label>
      <label>Breite m<input type="number" step=".1" data-roof="${r.id}" data-k="width" value="${r.width}"></label>
      <label>Tiefe m<input type="number" step=".1" data-roof="${r.id}" data-k="depth" value="${r.depth}"></label>
      <label>Neigung °<input type="number" min="0" max="90" data-roof="${r.id}" data-k="tilt" value="${r.tilt}"></label>
      <label>Azimut °<input type="number" min="-180" max="180" data-roof="${r.id}" data-k="azimuth" value="${r.azimuth}"></label>
      <label>Nutzfaktor<input type="number" min=".1" max="1" step=".05" data-roof="${r.id}" data-k="usableFactor" value="${r.usableFactor}"></label>
      <label><input type="checkbox" data-roof="${r.id}" data-k="manualKwpEnabled" ${r.manualKwpEnabled?"checked":""}> kWp manuell</label>
      <label>kWp<input type="number" step=".1" data-roof="${r.id}" data-k="manualKwp" value="${r.manualKwp}"></label>
    </div>
    <div class="metric"><span>Fläche / Ausrichtungsfaktor / kWp</span><strong>${fmt(r.width*r.depth,1)} m² · ${fmt(orientationFactor(r.tilt,r.azimuth),2)} · ${fmt(roofKwp(r),2)} kWp</strong></div>`;
    box.appendChild(el);
  });
}
function renderPVFields(){
  const box=$("pvFieldsList");box.innerHTML="";
  state.pv.fields.forEach((f,i)=>{
    const options=state.pv.roofs.map(r=>`<option value="${r.id}" ${f.roofId===r.id?"selected":""}>${escapeHtml(r.name)}</option>`).join("");
    const el=document.createElement("div");el.className="entity";
    el.innerHTML=`<div class="entity-head"><strong>Modulfeld ${i+1}</strong><button class="danger" data-del-field="${f.id}">Löschen</button></div>
    <div class="entity-grid">
      <label>Dach<select data-field="${f.id}" data-k="roofId">${options}</select></label>
      <label>Hersteller<input data-field="${f.id}" data-k="manufacturer" value="${escapeAttr(f.manufacturer||"")}"></label>
      <label>Typ<input data-field="${f.id}" data-k="model" value="${escapeAttr(f.model||"")}"></label>
      <label>W/Modul<input type="number" data-field="${f.id}" data-k="moduleW" value="${f.moduleW}"></label>
      <label>Anzahl<input type="number" data-field="${f.id}" data-k="count" value="${f.count}"></label>
    </div>
    <div class="metric"><span>Leistung</span><strong>${fmt((f.moduleW||0)*(f.count||0)/1000,2)} kWp</strong></div>`;
    box.appendChild(el);
  });
}
function renderInverters(){
  const box=$("invertersList");box.innerHTML="";
  state.pv.inverters.forEach((w,i)=>{
    const el=document.createElement("div");el.className="entity";
    el.innerHTML=`<div class="entity-head"><strong>WR ${i+1}</strong><button class="danger" data-del-inv="${w.id}">Löschen</button></div>
    <div class="entity-grid">
      <label>Hersteller<input data-inv="${w.id}" data-k="manufacturer" value="${escapeAttr(w.manufacturer||"")}"></label>
      <label>Typ<input data-inv="${w.id}" data-k="model" value="${escapeAttr(w.model||"")}"></label>
      <label>AC kW<input type="number" step=".1" data-inv="${w.id}" data-k="acKW" value="${w.acKW}"></label>
    </div>`;
    box.appendChild(el);
  });
}
function renderChargers(){
  const box=$("chargersList");box.innerHTML="";
  state.charging.chargers.forEach((c,i)=>{
    const el=document.createElement("div");el.className="entity";
    el.innerHTML=`<div class="entity-head"><strong>Ladegruppe ${i+1}</strong><button class="danger" data-del-charger="${c.id}">Löschen</button></div>
    <div class="entity-grid">
      <label>Name<input data-charger="${c.id}" data-k="name" value="${escapeAttr(c.name||"")}"></label>
      <label>Typ<select data-charger="${c.id}" data-k="type"><option ${c.type==="AC"?"selected":""}>AC</option><option ${c.type==="DC"?"selected":""}>DC</option></select></label>
      <label>kW/Punkt<input type="number" data-charger="${c.id}" data-k="kwEach" value="${c.kwEach}"></label>
      <label>Anzahl<input type="number" data-charger="${c.id}" data-k="count" value="${c.count}"></label>
    </div>`;
    box.appendChild(el);
  });
}
function renderFleet(){
  const box=$("fleetList");box.innerHTML="";
  state.charging.fleet.forEach((f,i)=>{
    const el=document.createElement("div");el.className="entity";
    el.innerHTML=`<div class="entity-head"><strong>Fahrzeuggruppe ${i+1}</strong><button class="danger" data-del-fleet="${f.id}">Löschen</button></div>
    <div class="entity-grid">
      <label>Klasse<select data-fleet="${f.id}" data-k="class"><option ${f.class==="PKW"?"selected":""}>PKW</option><option ${f.class==="Transporter"?"selected":""}>Transporter</option><option ${f.class==="LKW"?"selected":""}>LKW</option></select></label>
      <label>Anzahl<input type="number" data-fleet="${f.id}" data-k="count" value="${f.count}"></label>
      <label>km/Jahr<input type="number" data-fleet="${f.id}" data-k="kmYear" value="${f.kmYear}"></label>
      <label>kWh/100 km<input type="number" step=".1" data-fleet="${f.id}" data-k="kwh100" value="${f.kwh100}"></label>
      <label>L/100 km<input type="number" step=".1" data-fleet="${f.id}" data-k="l100" value="${f.l100}"></label>
    </div>`;
    box.appendChild(el);
  });
}
function bindDynamic(){
  document.body.oninput=e=>{
    const t=e.target;
    const map=(arr,id,key)=>{
      const item=arr.find(x=>x.id===id); if(!item)return;
      item[key]=t.type==="checkbox"?t.checked:(t.type==="number"?Number(t.value):t.value);
    };
    if(t.dataset.roof)map(state.pv.roofs,t.dataset.roof,t.dataset.k);
    if(t.dataset.field)map(state.pv.fields,t.dataset.field,t.dataset.k);
    if(t.dataset.inv)map(state.pv.inverters,t.dataset.inv,t.dataset.k);
    if(t.dataset.charger)map(state.charging.chargers,t.dataset.charger,t.dataset.k);
    if(t.dataset.fleet){
      map(state.charging.fleet,t.dataset.fleet,t.dataset.k);
      if(t.dataset.k==="class"){
        const f=state.charging.fleet.find(x=>x.id===t.dataset.fleet);
        if(f){const d=f.class==="PKW"?[18,7]:f.class==="Transporter"?[28,10]:[120,30];f.kwh100=d[0];f.l100=d[1];f.fuelType="diesel";renderFleet()}
      }
    }
    refreshMetrics();localStorage.setItem("profiPlanungOS",JSON.stringify(state));
  };
  document.body.onclick=e=>{
    const t=e.target;
    const del=(arr,id)=>{const i=arr.findIndex(x=>x.id===id);if(i>=0)arr.splice(i,1)};
    if(t.dataset.delRoof){del(state.pv.roofs,t.dataset.delRoof);state.pv.fields.forEach(f=>{if(f.roofId===t.dataset.delRoof)f.roofId=state.pv.roofs[0]?.id||null});renderRoofs();renderPVFields()}
    if(t.dataset.delField){del(state.pv.fields,t.dataset.delField);renderPVFields()}
    if(t.dataset.delInv){del(state.pv.inverters,t.dataset.delInv);renderInverters()}
    if(t.dataset.delCharger){del(state.charging.chargers,t.dataset.delCharger);renderChargers()}
    if(t.dataset.delFleet){del(state.charging.fleet,t.dataset.delFleet);renderFleet()}
    refreshMetrics();localStorage.setItem("profiPlanungOS",JSON.stringify(state));
  };
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function escapeAttr(s){return escapeHtml(s)}

function drawSeries(canvasId,values,labels,color="#0b5fff"){
  const c=$(canvasId),ctx=c.getContext("2d"),dpr=window.devicePixelRatio||1;
  const w=c.clientWidth||600,h=Number(c.getAttribute("height"))||240;c.width=w*dpr;c.height=h*dpr;ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,w,h);ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);
  if(!values.length){ctx.fillStyle="#667085";ctx.fillText("Keine Daten",20,30);return}
  const min=Math.min(...values),max=Math.max(...values),span=Math.max(max-min,1e-9),pad=28;
  ctx.strokeStyle="#e3e8ef";ctx.lineWidth=1;
  for(let i=0;i<5;i++){let y=pad+(h-2*pad)*i/4;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke()}
  ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();
  values.forEach((v,i)=>{const x=pad+(w-2*pad)*(i/(values.length-1||1)), y=h-pad-(h-2*pad)*((v-min)/span);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});
  ctx.stroke();
  ctx.fillStyle="#667085";ctx.font="11px -apple-system";
  ctx.fillText(fmt(max,1),2,pad+4);ctx.fillText(fmt(min,1),2,h-pad+4);
}
function refreshMetrics(){
  pullStaticInputs();
  const k=loadKPIs(),eco=economics();
  $("hakKWMetric").textContent=`${fmt(hakKW(),1)} kW`;
  $("statusPeak").textContent=`${fmt(k.peak,1)} kW`;$("statusPV").textContent=`${fmt(pvTotalKWp(),2)} kWp`;
  $("statusBat").textContent=`${fmt(state.battery.kwh,0)} kWh / ${fmt(state.battery.kw,0)} kW`;
  $("statusCharge").textContent=`${fmt(chargerTotalKW(),1)} kW`;$("statusPayback").textContent=Number.isFinite(eco.payback)?`${fmt(eco.payback,1)} Jahre`:"—";
  $("loadPeak").textContent=`${fmt(k.peak,1)} kW`;$("loadP95").textContent=`${fmt(k.p95,1)} kW`;$("loadAvg").textContent=`${fmt(k.avg,1)} kW`;$("loadEnergy").textContent=`${fmt(k.energy,0)} kWh/a`;
  const sample=(state.load.points||[]).slice(0,Math.min(672,state.load.points.length));drawSeries("loadChart",sample.map(x=>Number(x.kw)||0),sample.map(x=>x.timestamp));
  $("pvTotalMetric").textContent=`${fmt(pvTotalKWp(),2)} kWp`;$("pvAnnualMetric").textContent=`${fmt(annualPV(),0)} kWh/a`;
  $("chargerTotalMetric").textContent=`${fmt(chargerTotalKW(),1)} kW`;$("fleetEnergyMetric").textContent=`${fmt(fleetEnergy(),0)} kWh/a`;
  $("chargeHoursMetric").textContent=chargerTotalKW()>0?`${fmt((fleetEnergy()/365)/chargerTotalKW(),1)} h`:"—";
  $("thgMetric").textContent=money(fleetCount()*state.economics.thgRate);$("evCostMetric").textContent=money(evCost());$("dieselCostMetric").textContent=money(dieselBaselineCost());
  $("fleetSavingMetric").textContent=money(Math.max(dieselBaselineCost()-evCost(),0));$("fleetEVKWhMetric").textContent=`${fmt(fleetEnergy(),0)} kWh/a`;
  $("fleetFuelLitersMetric").textContent=`${fmt(fleetFuelLiters(),0)} L/a`;
  $("arbProfitMetric").textContent=`${money(arbitrageProfit())}/a`;$("peakSavingMetric").textContent=`${money(peakSaving())}/a`;
  $("capexMetric").textContent=money(eco.capex);$("annualBenefitMetric").textContent=`${money(eco.annualBenefit)}/a`;
  $("paybackMetric").textContent=Number.isFinite(eco.payback)?`${fmt(eco.payback,1)} Jahre`:"—";$("tenYearMetric").textContent=money(eco.tenYear);
  drawSeries("cashflowChart",eco.series.map(x=>x.value),eco.series.map(x=>x.year),"#16803a");
  refreshWarnings();
}
function refreshWarnings(){
  const lw=[],cw=[];
  const k=loadKPIs();
  if(!state.load.points.length) lw.push(["warn","Kein Lastgang vorhanden."]);
  if(k.peak>2000)lw.push(["warn","Sehr hoher Last-Peak – Einheit und Anschlussleistung prüfen."]);
  $("loadWarnings").innerHTML=lw.map(([c,t])=>`<div class="notice ${c}">${t}</div>`).join("");
  const daily=fleetEnergy()/365,cap=chargerTotalKW()*10;
  if(fleetEnergy()>0&&chargerTotalKW()===0)cw.push(["bad","Fuhrpark vorhanden, aber keine Ladeleistung."]);
  else if(cap>0&&daily/cap>.9)cw.push(["warn","Ladeinfrastruktur ist energetisch knapp dimensioniert."]);
  if(chargerTotalKW()>hakKW()&&!state.grid.emsEnabled)cw.push(["bad","Installierte Ladeleistung liegt über HAK-Leistung; EMS/Lastmanagement prüfen."]);
  $("chargingWarnings").innerHTML=cw.map(([c,t])=>`<div class="notice ${c}">${t}</div>`).join("");
}
function refreshAll(){renderRoofs();renderPVFields();renderInverters();renderChargers();renderFleet();refreshMetrics();refreshForecastTable()}

$("addRoofBtn").onclick=()=>{state.pv.roofs.push({id:uuid(),name:`Dach ${state.pv.roofs.length+1}`,width:10,depth:6,tilt:30,azimuth:0,usableFactor:.8,manualKwpEnabled:false,manualKwp:0});renderRoofs();renderPVFields();saveState(false)};
$("addPVFieldBtn").onclick=()=>{state.pv.fields.push({id:uuid(),roofId:state.pv.roofs[0]?.id||null,manufacturer:"",model:"",moduleW:440,count:12});renderPVFields();saveState(false)};
$("addInverterBtn").onclick=()=>{state.pv.inverters.push({id:uuid(),manufacturer:"",model:"",acKW:10});renderInverters();saveState(false)};
$("addChargerBtn").onclick=()=>{state.charging.chargers.push({id:uuid(),name:"AC Ladepunkt",type:"AC",kwEach:11,count:1});renderChargers();saveState(false)};
$("addFleetBtn").onclick=()=>{state.charging.fleet.push({id:uuid(),class:"PKW",count:1,kmYear:20000,kwh100:18,l100:7,fuelType:"diesel"});renderFleet();saveState(false)};

$("saveBtn").onclick=()=>saveState(true);

$("loadMode").onchange=()=>{
  const mode=$("loadMode").value;
  ["loadImportBox","loadIndustryBox","loadBusinessBox","loadMastBox"].forEach(id=>$(id).classList.add("hidden"));
  $(mode==="import"?"loadImportBox":mode==="industry"?"loadIndustryBox":mode==="business"?"loadBusinessBox":"loadMastBox").classList.remove("hidden");
};

function generateHourly(fn){
  const start=new Date(new Date().getFullYear(),0,1,0,0,0,0),out=[];
  for(let i=0;i<365*24;i++){const d=new Date(start.getTime()+i*3600000);out.push({timestamp:d.toISOString(),kw:Math.max(0,fn(d,i))})}
  state.load.points=out;state.load.resolutionHours=1;refreshMetrics();saveState(false)
}
$("genIndustryBtn").onclick=()=>{
  const shifts=Number($("industryShifts").value),startH=Number($("industryStart").value),base=Number($("industryBase").value),prod=Number($("industryProd").value),weekend=$("industryWeekend").checked,startup=$("industryStartup").checked;
  generateHourly((d)=>{
    const h=d.getHours(),wd=d.getDay(),work=weekend||!(wd===0||wd===6);let active=false;
    if(shifts===3)active=work; else active=work && h>=startH && h<Math.min(24,startH+shifts*8);
    let v=base+(active?prod:0); if(startup&&active&&h===startH)v+=prod*.25;return v;
  });state.load.source="Industrie";
};
$("genBusinessBtn").onclick=()=>{
  const base=Number($("businessBase").value),day=Number($("businessDay").value),sat=$("businessSaturday").checked;
  generateHourly(d=>{const h=d.getHours(),wd=d.getDay(),work=wd>=1&&wd<=5||(sat&&wd===6),active=work&&h>=7&&h<18;return base+(active?day:0)});
  state.load.source="Gewerbe";
};
$("genMastBtn").onclick=()=>{
  const base=Number($("mastBase").value),animals=Number($("mastAnimals").value),per=Number($("mastKWAnimal").value),cycle=Number($("mastCycle").value)||112;
  const p1d=Number($("mastP1Days").value),p2d=Number($("mastP2Days").value),p1m=Number($("mastP1Mult").value),p2m=Number($("mastP2Mult").value),p3m=Number($("mastP3Mult").value);
  generateHourly((d,i)=>{const day=Math.floor(i/24)%cycle,h=d.getHours();const mult=day<p1d?p1m:day<p1d+p2d?p2m:p3m;const vent=h>=10&&h<=18?1.15:1;return (base+animals*per)*mult*vent});
  state.load.source="Maststall";
};

function parseCSV(text,sepSetting,unitSetting){
  const lines=text.split(/\r?\n/).filter(x=>x.trim()); if(lines.length<2)throw new Error("Datei enthält zu wenige Zeilen.");
  let sep=sepSetting;
  if(sep==="auto"){const first=lines[0];sep=[";",",","\t"].sort((a,b)=>(first.split(b).length-first.split(a).length))[0]}
  const rows=lines.map(l=>l.split(sep).map(x=>x.trim().replace(/^"|"$/g,"")));
  const head=rows[0].map(x=>x.toLowerCase());
  let ti=head.findIndex(x=>/timestamp|datetime|datum|zeit|time/.test(x)); if(ti<0)ti=0;
  let vi=head.findIndex(x=>/kw\b|kwh|value|leistung|verbrauch|last|power|energy/.test(x)); if(vi<0)vi=Math.min(1,head.length-1);
  let unit=unitSetting;if(unit==="auto")unit=/kwh/.test(head[vi])?"kwh":"kw";
  const data=[];
  for(const r of rows.slice(1)){if(r.length<=Math.max(ti,vi))continue;const d=new Date(r[ti]);let val=Number(String(r[vi]).replace(",", "."));if(!Number.isFinite(d.getTime())||!Number.isFinite(val))continue;data.push({timestamp:d.toISOString(),raw:val})}
  if(!data.length)throw new Error("Keine gültigen Zeit-/Wertzeilen erkannt.");
  data.sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
  const dt=data.length>1?Math.abs(new Date(data[1].timestamp)-new Date(data[0].timestamp))/3600000:1;
  return {points:data.map(x=>({timestamp:x.timestamp,kw:unit==="kwh"?x.raw/Math.max(dt,.001):x.raw})),dt};
}
$("importLoadBtn").onclick=async()=>{
  const f=$("loadFile").files[0];if(!f)return alert("Bitte Datei auswählen.");
  try{
    const text=await f.text();
    if(f.name.toLowerCase().endsWith(".json")){
      const j=JSON.parse(text);
      if(Array.isArray(j)){state.load.points=j.map(x=>({timestamp:x.timestamp||x.time,kw:Number(x.kw??x.value??0)}))}
      else if(j.load?.points){state.load.points=j.load.points;state.load.resolutionHours=j.load.resolutionHours||1}
      else if(j.project&&j.loadProfile){state.load.points=j.loadProfile.map(x=>({timestamp:x.timestamp,kw:Number(x.kw)}))}
      else throw new Error("JSON-Struktur nicht erkannt.");
    }else{
      const p=parseCSV(text,$("csvSeparator").value,$("importUnit").value);state.load.points=p.points;state.load.resolutionHours=p.dt;
    }
    state.load.source=f.name;refreshMetrics();saveState(false);alert(`Importiert: ${state.load.points.length} Punkte`);
  }catch(e){alert(`Import fehlgeschlagen: ${e.message}`)}
};

$("recommendBatteryBtn").onclick=()=>{
  pullStaticInputs();const k=loadKPIs(),daily=k.energy/365,obj=state.battery.objective;let kwh=0,kw=0,reason="";
  if(!k.energy){$("batteryRecommendation").innerHTML='<div class="notice warn">Bitte zuerst Lastgang importieren oder erzeugen.</div>';return}
  if(obj==="Eigenverbrauch"){kwh=Math.max(daily*.35,10);kw=Math.max(kwh*.5,5);reason="Verschiebung von ca. 35 % des Tagesverbrauchs."}
  else if(obj==="Peakshaving"){kw=Math.max(k.peak-k.p95*.85,10);kwh=Math.max(kw*1.5,10);reason="Leistung aus Peak-Abstand, Energie für ca. 1,5 h."}
  else if(obj==="Eigenverbrauch + Peakshaving"){const a=Math.max(daily*.35,10),b=Math.max(k.peak-k.p95*.85,10);kwh=Math.max(a,b*1.5);kw=Math.max(a*.5,b);reason="Kombination aus Energieverschiebung und Spitzenlast."}
  else if(obj==="Arbitrage"){kwh=Math.max(daily*.7,100);kw=Math.max(kwh*.5,50);reason="Größere Startdimension für Preisarbitrage."}
  else{kwh=Math.max(daily*.5,50);kw=Math.max(kwh*.45,k.peak*.12,10);reason="Multi-Use aus Eigenverbrauch, Peakshaving und Flexibilität."}
  const maxGrid=hakKW();if(maxGrid>0)kw=Math.min(kw,maxGrid);
  $("batteryRecommendation").innerHTML=`<div class="notice ok"><strong>${fmt(kwh,0)} kWh / ${fmt(kw,0)} kW</strong><br>${reason}</div>
  <button id="applyRecBtn" class="secondary">Übernehmen</button>`;
  $("applyRecBtn").onclick=()=>{state.battery.kwh=Math.round(kwh);state.battery.kw=Math.round(kw);setStaticInputs();refreshMetrics();saveState(false)};
};
$("compareBatteryBtn").onclick=()=>{
  pullStaticInputs();const k=loadKPIs();if(!k.energy){$("batteryComparison").innerHTML='<div class="notice warn">Lastgang fehlt.</div>';return}
  const daily=k.energy/365,base=Math.max(daily*.25,10),variants=[.5,1,1.5,2].map(m=>{const kwh=base*m,kw=Math.max(kwh*.5,5),capex=kwh*state.battery.capexKWh+kw*state.battery.capexKW;
    const shift=Math.min(annualPV()*.35,k.energy*.35,kwh*220)*state.battery.eta, benefit=shift*Math.max(state.economics.gridPrice-state.economics.feedIn,0);
    return {kwh,kw,capex,benefit,pb:benefit>0?capex/benefit:Infinity}});
  $("batteryComparison").innerHTML=`<div class="table-wrap"><table><thead><tr><th>kWh</th><th>kW</th><th>CAPEX</th><th>Nutzen/a</th><th>Amort.</th></tr></thead><tbody>${variants.map(v=>`<tr><td>${fmt(v.kwh,0)}</td><td>${fmt(v.kw,0)}</td><td>${money(v.capex)}</td><td>${money(v.benefit)}</td><td>${Number.isFinite(v.pb)?fmt(v.pb,1):"—"}</td></tr>`).join("")}</tbody></table></div>`;
};


async function fetchCurrentElectricityPrice(){
  pullStaticInputs();
  $("electricityPriceStatus").innerHTML='<div class="notice warn">Lade Fraunhofer ISE Day-Ahead-Preise …</div>';
  try{
    const today=new Date();
    const yyyy=today.getFullYear(),mm=String(today.getMonth()+1).padStart(2,"0"),dd=String(today.getDate()).padStart(2,"0");
    const day=`${yyyy}-${mm}-${dd}`;
    const url=`https://api.energy-charts.info/price?bzn=DE-LU&start=${encodeURIComponent(day)}&end=${encodeURIComponent(day)}`;
    const r=await fetch(url); if(!r.ok)throw new Error(`Energy-Charts HTTP ${r.status}`);
    const j=await r.json();
    let vals=[];
    if(Array.isArray(j.price)) vals=j.price.map(Number).filter(Number.isFinite);
    else if(Array.isArray(j.data)) vals=j.data.flatMap(x=>Array.isArray(x)?x:[x]).map(Number).filter(Number.isFinite);
    else{
      for(const v of Object.values(j)){
        if(Array.isArray(v)){
          const n=v.map(Number).filter(Number.isFinite);
          if(n.length) vals=vals.concat(n);
        }
      }
    }
    if(!vals.length)throw new Error("Keine Preiswerte erkannt.");
    // Energy-Charts price endpoint is typically EUR/MWh -> convert to EUR/kWh.
    const avgMWh=vals.reduce((a,b)=>a+b,0)/vals.length;
    const spot=avgMWh/1000;
    state.economics.lastSpotEURPerKWh=spot;
    if(state.economics.electricityPriceMode==="energycharts"){
      state.economics.gridPrice=Math.max(spot+state.economics.electricityMarkup,0);
      $("gridPrice").value=state.economics.gridPrice.toFixed(4);
    }
    $("electricityPriceStatus").innerHTML=`<div class="notice ok">Ø Day-Ahead heute: ${fmt(spot,4)} €/kWh${state.economics.electricityPriceMode==="energycharts"?` · mit Aufschlag: ${fmt(state.economics.gridPrice,4)} €/kWh`:""}</div>`;
    saveState(false);
  }catch(e){
    $("electricityPriceStatus").innerHTML=`<div class="notice bad">Strompreisabruf fehlgeschlagen: ${escapeHtml(e.message)}</div>`;
  }
}
$("fetchElectricityPriceBtn").onclick=fetchCurrentElectricityPrice;

async function fetchFuelPrices(){
  pullStaticInputs();
  const key=state.economics.tankerkoenigKey;
  if(!key){$("fuelPriceStatus").innerHTML='<div class="notice warn">Bitte persönlichen Tankerkönig API-Key eingeben.</div>';return}
  $("fuelPriceStatus").innerHTML='<div class="notice warn">Lade aktuelle MTS-K-Spritpreise …</div>';
  try{
    const params=new URLSearchParams({
      lat:String(state.project.latitude),lng:String(state.project.longitude),
      rad:String(Math.min(Math.max(state.economics.fuelRadius,1),25)),type:"all",sort:"dist",apikey:key
    });
    const r=await fetch(`https://creativecommons.tankerkoenig.de/json/list.php?${params}`);
    if(!r.ok)throw new Error(`Tankerkönig HTTP ${r.status}`);
    const j=await r.json(); if(!j.ok)throw new Error(j.message||"API meldet Fehler.");
    const stations=(j.stations||[]).filter(s=>s && s.isOpen!==false);
    const avg=type=>{
      const v=stations.map(s=>Number(s[type])).filter(x=>Number.isFinite(x)&&x>0);
      return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
    };
    state.economics.lastFuelPrices={diesel:avg("diesel"),e10:avg("e10"),e5:avg("e5")};
    const active=activeFuelPrice(state.economics.fuelType);
    $("fuelPriceStatus").innerHTML=`<div class="notice ok">Tankstellen: ${stations.length} · Diesel ${state.economics.lastFuelPrices.diesel?fmt(state.economics.lastFuelPrices.diesel,3)+" €/L":"—"} · E10 ${state.economics.lastFuelPrices.e10?fmt(state.economics.lastFuelPrices.e10,3)+" €/L":"—"} · E5 ${state.economics.lastFuelPrices.e5?fmt(state.economics.lastFuelPrices.e5,3)+" €/L":"—"}<br>Aktiver Vergleichspreis: ${fmt(active,3)} €/L</div>`;
    saveState(false);
  }catch(e){
    $("fuelPriceStatus").innerHTML=`<div class="notice bad">Spritpreisabruf fehlgeschlagen: ${escapeHtml(e.message)}</div>`;
  }
}
$("fetchFuelPriceBtn").onclick=fetchFuelPrices;

async function fetchRoofForecast(roof,days){
  const lat=state.project.latitude,lon=state.project.longitude;
  const params=new URLSearchParams({latitude:lat,longitude:lon,timezone:"Europe/Berlin",forecast_days:days,hourly:"temperature_2m,cloud_cover,global_tilted_irradiance",tilt:roof.tilt,azimuth:roof.azimuth});
  const r=await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);if(!r.ok)throw new Error(`Open-Meteo HTTP ${r.status}`);
  const j=await r.json();const h=j.hourly||{},kwp=roofKwp(roof),pr=state.pv.performanceRatio;
  const arr=(h.time||[]).map((t,i)=>({timestamp:t,irr:Number(h.global_tilted_irradiance?.[i]||0),temp:Number(h.temperature_2m?.[i]||0),cloud:Number(h.cloud_cover?.[i]||0)}));
  const kwh=arr.reduce((s,x)=>s+x.irr/1000*kwp*pr,0);
  return {roofId:roof.id,name:roof.name,kwp,kwh,points:arr};
}
$("fetchWeatherBtn").onclick=async()=>{
  pullStaticInputs();if(!state.pv.roofs.length)return alert("Bitte mindestens ein Dach anlegen.");
  $("weatherStatus").innerHTML='<div class="notice warn">Lade standortbezogene Prognosen je Dach …</div>';
  try{
    const res={};let total=0;const aggregate={};
    for(const roof of state.pv.roofs){
      const fc=await fetchRoofForecast(roof,state.forecast.days);res[roof.id]=fc;total+=fc.kwh;
      fc.points.forEach(p=>{aggregate[p.timestamp]=(aggregate[p.timestamp]||0)+p.irr/1000*fc.kwp*state.pv.performanceRatio});
    }
    state.forecast.roofForecasts=res;state.forecast.totalKWh=total;state.forecast.hourly=Object.entries(aggregate).map(([timestamp,kwh])=>({timestamp,kwh}));
    $("weatherStatus").innerHTML=`<div class="notice ok">Prognose geladen: ${Object.keys(res).length} Dächer · ${fmt(total,1)} kWh</div>`;
    saveState(false);refreshForecastTable();
  }catch(e){$("weatherStatus").innerHTML=`<div class="notice bad">Wetterabruf fehlgeschlagen: ${escapeHtml(e.message)}</div>`}
};
function refreshForecastTable(){
  const fs=state.forecast.roofForecasts||{},rows=state.pv.roofs.map(r=>{const f=fs[r.id];return `<tr><td>${escapeHtml(r.name)}</td><td>${fmt(roofKwp(r),2)} kWp</td><td>${fmt(r.tilt,0)}°</td><td>${fmt(r.azimuth,0)}°</td><td>${f?fmt(f.kwh,1):"—"} kWh</td></tr>`}).join("");
  $("roofForecastTable").innerHTML=`<div class="table-wrap"><table><thead><tr><th>Dach</th><th>kWp</th><th>Neigung</th><th>Azimut</th><th>${state.forecast.days}T Prognose</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  $("forecastPVMetric").textContent=`${fmt(state.forecast.totalKWh,1)} kWh / ${state.forecast.days} Tage`;
  drawSeries("forecastChart",(state.forecast.hourly||[]).map(x=>x.kwh),(state.forecast.hourly||[]).map(x=>x.timestamp),"#f59e0b");
}
function reportWarnings(){
  const arr=[],k=loadKPIs();if(!state.load.points.length)arr.push("Kein Lastgang hinterlegt.");if(pvTotalKWp()<=0)arr.push("Keine PV-Leistung hinterlegt.");
  const wr=state.pv.inverters.reduce((s,w)=>s+(Number(w.acKW)||0),0);if(pvTotalKWp()>0&&wr>pvTotalKWp()*1.5)arr.push("WR-Leistung > 150 % der PV-kWp prüfen.");
  if(state.battery.kwh>0&&state.battery.kw/state.battery.kwh>2)arr.push("Speicher C-Rate > 2C prüfen.");
  if(chargerTotalKW()>hakKW()&&!state.grid.emsEnabled)arr.push("Ladeleistung > HAK ohne EMS.");
  if(k.peak>hakKW()*1.15&&hakKW()>0)arr.push("Lastgang-Peak liegt deutlich über HAK-Rechenwert; Anschluss-/Messdaten prüfen.");
  return arr;
}
function refreshReport(){
  pullStaticInputs();const k=loadKPIs(),eco=economics(),sc=selfConsumptionEstimate(),warn=reportWarnings();
  $("reportWarnings").innerHTML=warn.length?warn.map(x=>`<div class="notice warn">${escapeHtml(x)}</div>`).join(""):'<div class="notice ok">Keine offensichtlichen Plausibilitätskonflikte.</div>';
  const roofs=state.pv.roofs.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${fmt(r.width*r.depth,1)} m²</td><td>${fmt(r.tilt,0)}°</td><td>${fmt(r.azimuth,0)}°</td><td>${fmt(roofKwp(r),2)} kWp</td><td>${fmt(roofKwp(r)*state.pv.specificYield*orientationFactor(r.tilt,r.azimuth),0)} kWh/a</td></tr>`).join("");
  $("reportContent").innerHTML=`<h1>Profi‑Planung OS – Projektbericht</h1>
  <p><strong>${escapeHtml(state.project.name)}</strong><br>Kunde: ${escapeHtml(state.project.customer||"—")}<br>Standort: ${escapeHtml(state.project.locationName||"—")} (${fmt(state.project.latitude,4)}, ${fmt(state.project.longitude,4)})</p>
  <h2>Übersicht</h2><div class="report-grid">
  <div class="report-kpi"><small>Lastgang Peak</small><br><strong>${fmt(k.peak,1)} kW</strong></div>
  <div class="report-kpi"><small>PV</small><br><strong>${fmt(pvTotalKWp(),2)} kWp</strong></div>
  <div class="report-kpi"><small>PV Jahresertrag</small><br><strong>${fmt(annualPV(),0)} kWh/a</strong></div>
  <div class="report-kpi"><small>Speicher</small><br><strong>${fmt(state.battery.kwh,0)} kWh / ${fmt(state.battery.kw,0)} kW</strong></div>
  <div class="report-kpi"><small>Ladeleistung</small><br><strong>${fmt(chargerTotalKW(),1)} kW</strong></div>
  <div class="report-kpi"><small>Amortisation</small><br><strong>${Number.isFinite(eco.payback)?fmt(eco.payback,1)+" Jahre":"—"}</strong></div></div>
  <h2>Dachflächen / PV</h2><table><thead><tr><th>Dach</th><th>Fläche</th><th>Neigung</th><th>Azimut</th><th>kWp</th><th>Jahresertrag</th></tr></thead><tbody>${roofs}</tbody></table>
  <p>Kurzfristige Wetter‑PV‑Prognose: <strong>${fmt(state.forecast.totalKWh,1)} kWh / ${state.forecast.days} Tage</strong>. Die Jahreswirtschaftlichkeit wird bewusst nicht aus einer einzelnen Wetterwoche hochgerechnet.</p>
  <h2>Energie & Wirtschaftlichkeit</h2>
  <table><tbody>
  <tr><td>Jahresverbrauch Lastgang</td><td>${fmt(k.energy,0)} kWh/a</td></tr>
  <tr><td>PV Eigenverbrauch geschätzt</td><td>${fmt(sc.selfUsed,0)} kWh/a</td></tr>
  <tr><td>PV Einspeisung geschätzt</td><td>${fmt(sc.export,0)} kWh/a</td></tr>
  <tr><td>PV-/Energie-Nutzen</td><td>${money(eco.pvBenefit)}/a</td></tr>
  <tr><td>Peakshaving</td><td>${money(eco.peak)}/a</td></tr>
  <tr><td>Arbitrage</td><td>${money(eco.arb)}/a</td></tr>
  <tr><td>THG</td><td>${money(eco.thg)}/a</td></tr>
  <tr><td>Verbrenner→EV Betriebskostenvorteil</td><td>${money(eco.fuelSaving)}/a</td></tr>
  <tr><td>Aktiver Strompreis</td><td>${fmt(state.economics.gridPrice,4)} €/kWh (${state.economics.electricityPriceMode})</td></tr>
  <tr><td>Aktiver Kraftstoffpreis</td><td>${fmt(activeFuelPrice(state.economics.fuelType),3)} €/L (${state.economics.fuelPriceMode})</td></tr>
  <tr><td>CAPEX</td><td>${money(eco.capex)}</td></tr>
  <tr><td>Nettonutzen</td><td>${money(eco.annualBenefit)}/a</td></tr>
  <tr><td>Amortisation</td><td>${Number.isFinite(eco.payback)?fmt(eco.payback,1)+" Jahre":"—"}</td></tr>
  </tbody></table>
  <h2>Ladeinfrastruktur</h2><p>${state.charging.chargers.length} Ladegruppen · ${fmt(chargerTotalKW(),1)} kW · ${state.charging.fleet.length} Fuhrparkgruppen · ${fmt(fleetEnergy(),0)} kWh/a EV‑Energie.</p>
  <h2>Hinweis</h2><p>Vorplanung: Netzanschluss, Messkonzept, Schutztechnik, Herstellerfreigaben, Tarife, THG‑Voraussetzungen und regulatorische Anforderungen sind projektspezifisch zu verifizieren.</p>`;
}
$("refreshReportBtn").onclick=refreshReport;$("printReportBtn").onclick=()=>{refreshReport();window.print()};
$("exportJSONBtn").onclick=()=>{pullStaticInputs();downloadBlob(JSON.stringify(state,null,2),`${safeName(state.project.name)}_Projekt.json`,"application/json")};
$("importProjectBtn").onclick=()=>$("projectJSONFile").click();
$("projectJSONFile").onchange=async()=>{const f=$("projectJSONFile").files[0];if(!f)return;try{state=deepMerge(structuredClone(DEFAULT),JSON.parse(await f.text()));localStorage.setItem("profiPlanungOS",JSON.stringify(state));setStaticInputs();refreshAll();alert("Projekt importiert.")}catch(e){alert(`Import fehlgeschlagen: ${e.message}`)}};
function safeName(s){return String(s||"Projekt").replace(/[^\p{L}\p{N}_-]+/gu,"_")}
function downloadBlob(content,name,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").classList.remove("hidden")});
$("installBtn").onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").classList.add("hidden")}else alert("Auf iPhone: Safari → Teilen → Zum Home-Bildschirm.")};

["projectName","customer","locationName","latitude","longitude","aiEnabled","hakMode","hakValue","emsEnabled","gridPrice","feedIn","demandCharge","dieselPrice","thgRate","analysisYears",
"electricityPriceMode","electricityMarkup","fuelPriceMode","fuelType","manualFuelPrice","fuelRadius","tankerkoenigKey",
"pvTotalOverrideEnabled","pvTotalOverride","specificYield","performanceRatio","batteryObjective","batteryKWh","batteryKW","batteryMinSOC","batteryEta","batteryCapexKWh","batteryCapexKW",
"arbitrageEnabled","arbLow","arbHigh","arbCycles","arbDeg","peakShavingEnabled","peakTargetKW","forecastDays","pvCapex","pvOpexPct","batOpexPct"].forEach(id=>{
  $(id).addEventListener("change",()=>{pullStaticInputs();localStorage.setItem("profiPlanungOS",JSON.stringify(state));refreshMetrics()})
});

if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.warn));
setStaticInputs();bindDynamic();refreshAll();refreshReport();
