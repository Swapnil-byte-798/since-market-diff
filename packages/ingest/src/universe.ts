/** NIFTY 50 constituents with sector assignments. NSE tickers, Yahoo suffix `.NS`. */

export interface SymbolDef {
  ticker: string
  name: string
  sectorId: string
}

export interface SectorDef {
  id: string
  name: string
  /** NSE sector index where one exists, for future benchmark refinement. */
  indexTicker: string | null
}

export const BENCHMARK = { ticker: '^NSEI', name: 'NIFTY 50' } as const

export const SECTORS: SectorDef[] = [
  { id: 'FIN', name: 'Financial Services', indexTicker: '^NSEBANK' },
  { id: 'IT', name: 'Information Technology', indexTicker: null },
  { id: 'ENERGY', name: 'Oil, Gas & Energy', indexTicker: null },
  { id: 'FMCG', name: 'Consumer Goods', indexTicker: null },
  { id: 'AUTO', name: 'Automobile', indexTicker: null },
  { id: 'PHARMA', name: 'Healthcare & Pharma', indexTicker: null },
  { id: 'METAL', name: 'Metals & Mining', indexTicker: null },
  { id: 'INFRA', name: 'Construction & Infrastructure', indexTicker: null },
  { id: 'TELECOM', name: 'Telecom', indexTicker: null },
  { id: 'POWER', name: 'Power & Utilities', indexTicker: null },
]

export const UNIVERSE: SymbolDef[] = [
  { ticker: 'HDFCBANK', name: 'HDFC Bank', sectorId: 'FIN' },
  { ticker: 'ICICIBANK', name: 'ICICI Bank', sectorId: 'FIN' },
  { ticker: 'SBIN', name: 'State Bank of India', sectorId: 'FIN' },
  { ticker: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sectorId: 'FIN' },
  { ticker: 'AXISBANK', name: 'Axis Bank', sectorId: 'FIN' },
  { ticker: 'BAJFINANCE', name: 'Bajaj Finance', sectorId: 'FIN' },
  { ticker: 'BAJAJFINSV', name: 'Bajaj Finserv', sectorId: 'FIN' },
  { ticker: 'INDUSINDBK', name: 'IndusInd Bank', sectorId: 'FIN' },
  { ticker: 'SBILIFE', name: 'SBI Life Insurance', sectorId: 'FIN' },
  { ticker: 'HDFCLIFE', name: 'HDFC Life Insurance', sectorId: 'FIN' },
  { ticker: 'TCS', name: 'Tata Consultancy Services', sectorId: 'IT' },
  { ticker: 'INFY', name: 'Infosys', sectorId: 'IT' },
  { ticker: 'HCLTECH', name: 'HCL Technologies', sectorId: 'IT' },
  { ticker: 'WIPRO', name: 'Wipro', sectorId: 'IT' },
  { ticker: 'TECHM', name: 'Tech Mahindra', sectorId: 'IT' },
  { ticker: 'LTIM', name: 'LTIMindtree', sectorId: 'IT' },
  { ticker: 'RELIANCE', name: 'Reliance Industries', sectorId: 'ENERGY' },
  { ticker: 'ONGC', name: 'Oil & Natural Gas Corp', sectorId: 'ENERGY' },
  { ticker: 'BPCL', name: 'Bharat Petroleum', sectorId: 'ENERGY' },
  { ticker: 'COALINDIA', name: 'Coal India', sectorId: 'ENERGY' },
  { ticker: 'HINDUNILVR', name: 'Hindustan Unilever', sectorId: 'FMCG' },
  { ticker: 'ITC', name: 'ITC', sectorId: 'FMCG' },
  { ticker: 'NESTLEIND', name: 'Nestle India', sectorId: 'FMCG' },
  { ticker: 'BRITANNIA', name: 'Britannia Industries', sectorId: 'FMCG' },
  { ticker: 'TATACONSUM', name: 'Tata Consumer Products', sectorId: 'FMCG' },
  { ticker: 'MARUTI', name: 'Maruti Suzuki', sectorId: 'AUTO' },
  { ticker: 'M&M', name: 'Mahindra & Mahindra', sectorId: 'AUTO' },
  { ticker: 'TATAMOTORS', name: 'Tata Motors', sectorId: 'AUTO' },
  { ticker: 'EICHERMOT', name: 'Eicher Motors', sectorId: 'AUTO' },
  { ticker: 'HEROMOTOCO', name: 'Hero MotoCorp', sectorId: 'AUTO' },
  { ticker: 'BAJAJ-AUTO', name: 'Bajaj Auto', sectorId: 'AUTO' },
  { ticker: 'SUNPHARMA', name: 'Sun Pharmaceutical', sectorId: 'PHARMA' },
  { ticker: 'DRREDDY', name: "Dr. Reddy's Laboratories", sectorId: 'PHARMA' },
  { ticker: 'CIPLA', name: 'Cipla', sectorId: 'PHARMA' },
  { ticker: 'DIVISLAB', name: "Divi's Laboratories", sectorId: 'PHARMA' },
  { ticker: 'APOLLOHOSP', name: 'Apollo Hospitals', sectorId: 'PHARMA' },
  { ticker: 'TATASTEEL', name: 'Tata Steel', sectorId: 'METAL' },
  { ticker: 'JSWSTEEL', name: 'JSW Steel', sectorId: 'METAL' },
  { ticker: 'HINDALCO', name: 'Hindalco Industries', sectorId: 'METAL' },
  { ticker: 'LT', name: 'Larsen & Toubro', sectorId: 'INFRA' },
  { ticker: 'ULTRACEMCO', name: 'UltraTech Cement', sectorId: 'INFRA' },
  { ticker: 'GRASIM', name: 'Grasim Industries', sectorId: 'INFRA' },
  { ticker: 'ADANIPORTS', name: 'Adani Ports & SEZ', sectorId: 'INFRA' },
  { ticker: 'ADANIENT', name: 'Adani Enterprises', sectorId: 'INFRA' },
  { ticker: 'ASIANPAINT', name: 'Asian Paints', sectorId: 'INFRA' },
  { ticker: 'TITAN', name: 'Titan Company', sectorId: 'FMCG' },
  { ticker: 'BHARTIARTL', name: 'Bharti Airtel', sectorId: 'TELECOM' },
  { ticker: 'NTPC', name: 'NTPC', sectorId: 'POWER' },
  { ticker: 'POWERGRID', name: 'Power Grid Corporation', sectorId: 'POWER' },
  { ticker: 'UPL', name: 'UPL', sectorId: 'INFRA' },
]

export const symbolId = (ticker: string) => `${ticker}.NS`
export const BENCHMARK_ID = BENCHMARK.ticker
