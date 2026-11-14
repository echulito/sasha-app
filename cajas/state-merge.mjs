// Combina los cambios de este dispositivo con lo que otro dispositivo ya guardó en Google,
// en vez de frenar con "hay otra revisión". Trabaja dato por dato (un informe, un día, una revisión…).
import {reportKey} from './domain.mjs';

const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
// Huella corta de un dato (dos FNV-1a de 32 bits): alcanza para saber si cambió.
export function hashOf(value){
 const text=stable(value)??'';let a=0x811c9dc5,b=0x1b873593;
 for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,0x01000193);b=Math.imul(b^c,0x85ebca6b)+i|0;}
 return (a>>>0).toString(36)+'.'+(b>>>0).toString(36);
}
const BY_DATE=new Set(['attendance','closedDays','controlReviews','couponReviews']);
function itemKey(collection,item){
 if(item===null||typeof item!=='object')return 'p:'+String(item);
 if(collection==='reports'){try{return 'r:'+reportKey(item);}catch{return 'h:'+hashOf(item);}}
 if(item.id!==undefined&&item.id!=='')return 'i:'+item.id;
 if(collection==='expenseReceipts'&&item.expenseKey)return 'e:'+item.expenseKey;
 if(BY_DATE.has(collection)&&item.date)return 'd:'+item.date;
 return 'h:'+hashOf(item);
}
// Cada parte del estado como "clave → dato": listas por su identificador, objetos por propiedad, lo demás entero.
function toMap(collection,value){
 const map=new Map();
 if(value===undefined)return map;
 if(Array.isArray(value)){for(const item of value){let key=itemKey(collection,item),n=1;while(map.has(n>1?key+'#'+n:key))n++;map.set(n>1?key+'#'+n:key,item);}return map;}
 if(value&&typeof value==='object'){for(const [k,v] of Object.entries(value))map.set('o:'+k,v);return map;}
 map.set('',value);return map;
}
function fromMap(model,map){
 if(Array.isArray(model))return [...map.values()];
 if(model&&typeof model==='object')return Object.fromEntries([...map].map(([k,v])=>[k.slice(2),v]));
 return map.get('');
}
/** Huellas de un estado ya sincronizado: sirve de "punto de partida" para saber después qué cambió cada lado. */
export function digestState(state){
 const out={};
 for(const [collection,value] of Object.entries(state||{})){out[collection]={};for(const [key,item] of toMap(collection,value))out[collection][key]=hashOf(item);}
 return out;
}
const LABELS={reports:'informe importado',attendance:'asistencia',completedDays:'día confirmado',couponReviews:'revisión de cupones',failedPayments:'cobro no efectuado',alertReviews:'alerta revisada',closingCorrections:'corrección de cierre',
 ticketDifferences:'diferencia de ticket',otherChecks:'otro control',declarationErrors:'error de declaración',paymentMethodErrors:'error de medio de pago',salesOutsideClose:'venta fuera de cierre',excludedProductCodes:'producto excluido',
 expenseReceipts:'comprobante de gasto',metricGoals:'objetivo',teamSubmissions:'envío de cajera',teamApplied:'envío aplicado',closedDays:'día cerrado',controlReviews:'control del día',cashiers:'cajera',manual:'carga manual'};
const fecha=d=>/^\d{4}-\d{2}-\d{2}/.test(String(d||''))?String(d).slice(8,10)+'/'+String(d).slice(5,7):'';
function label(collection,item){
 const f=item&&typeof item==='object'?fecha(item.date):fecha(item);
 return (LABELS[collection]||collection)+(f?' '+f:'')+(item&&typeof item==='object'&&item.name?' '+item.name:'');
}
/**
 * local: lo de este dispositivo (con cambios sin subir). remote: lo que hay en Google. base: huellas del último estado
 * sincronizado en este dispositivo (digestState) o null si no se conoce.
 * Con base: cada lado aporta lo que cambió; si los dos cambiaron el mismo dato, queda el de este dispositivo.
 * Sin base: se suman los datos que solo tiene un lado; si el mismo dato difiere, queda el de Google.
 * Devuelve {state, conflicts:[texto], changed} (changed: hay algo para subir a Google).
 */
export function mergeStates(local,remote,base){
 const state={},conflicts=[];let changed=false;
 for(const collection of new Set([...Object.keys(remote||{}),...Object.keys(local||{})])){
  const model=remote?.[collection]!==undefined?remote[collection]:local[collection];
  const L=toMap(collection,local?.[collection]),R=toMap(collection,remote?.[collection]),B=base?base[collection]||{}:null;
  const result=new Map(R);
  for(const key of new Set([...R.keys(),...L.keys(),...Object.keys(B||{})])){
   const l=L.get(key),r=R.get(key),inL=L.has(key),inR=R.has(key),hl=inL?hashOf(l):null,hr=inR?hashOf(r):null;
   if(hl===hr)continue;
   const useLocal=()=>{inL?result.set(key,l):result.delete(key);changed=true;};
   if(B){
    const hb=B[key]??null;
    if(hl===hb)continue;                 // este dispositivo no lo tocó: vale Google
    if(hr!==hb)conflicts.push(label(collection,inL?l:r));
    useLocal();
   }else if(!inR)useLocal();
   else if(inL)conflicts.push(label(collection,l));
  }
  state[collection]=fromMap(model,result);
 }
 return {state,conflicts:[...new Set(conflicts)],changed};
}
