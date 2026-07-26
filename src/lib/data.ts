import dataset from '../../data/btc-price-daily.json';
import type { PriceDataset } from '../../pipeline/schema';

/** Pipeline-committed dataset the whole site builds from. */
export const btcDaily = dataset as PriceDataset;
