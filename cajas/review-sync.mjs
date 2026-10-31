import {normalizeState,controlReviewSignature} from './domain.mjs';
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export function mergeRemoteReviews(local,remote){
 if(!remote)return {state:local,sameData:false};
 const state=normalizeState(structuredClone(local)),server=normalizeState(structuredClone(remote));
 const omit=s=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=='controlReviews'));
 const sameData=stable(omit(state))===stable(omit(server));
 for(const review of server.controlReviews||[]){
  if(review.signature!==controlReviewSignature(state,review.date))continue;
  state.controlReviews=(state.controlReviews||[]).filter(r=>r.date!==review.date);
  state.controlReviews.push(structuredClone(review));
 }
 return {state,sameData};
}
