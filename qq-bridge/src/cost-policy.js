import {isPeakAt,DEFAULT_PRICE_TABLE} from './model-prices.js';

export function costPolicy(at=Date.now(),table=DEFAULT_PRICE_TABLE){
  const peak=isPeakAt(at,table);
  return {peak,tier:peak?'peak':'off',learnMinUsers:peak?8:4,learnMaxWaitMs:(peak?30:15)*60000};
}
