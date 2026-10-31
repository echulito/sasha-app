import {isClosedDay} from './domain.mjs';
import {summarize} from './parser.mjs';
export function declaredCashWithdrawals(closes){return closes.reduce((sum,row)=>sum+row.withdrawals-(row.expenses||[]).reduce((n,e)=>n+e.amount,0)+(row.closingWithdrawal??0),0);}
export function dailyTicketAverage(state,receipts,dates){const worked=[...new Set(dates)].filter(date=>!isClosedDay(date,state));const missing=worked.filter(date=>!receipts.some(r=>r.date===date));const tickets=summarize(receipts.filter(r=>worked.includes(r.date))).tickets;return {days:worked.length,tickets,missing,average:worked.length&&!missing.length?tickets/worked.length:null};}
