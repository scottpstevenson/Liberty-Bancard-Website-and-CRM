export interface IndustryCode {
  mcc?: string;
  mccDescription?: string;
  sic?: string;
  sicDescription?: string;
}

export const VERTICAL_INDUSTRY_CODES: Record<string, IndustryCode[]> = {
  Restaurant: [
    { mcc: "5812", mccDescription: "Eating Places and Restaurants", sic: "5812", sicDescription: "Eating Places" },
    { mcc: "5813", mccDescription: "Bars, Cocktail Lounges, Discotheques", sic: "5813", sicDescription: "Drinking Places" },
    { mcc: "5814", mccDescription: "Fast Food Restaurants", sic: "5812", sicDescription: "Eating Places" },
    { mcc: "5441", mccDescription: "Candy, Nut, and Confectionery Stores", sic: "5441", sicDescription: "Candy, Nut, Confectionery" },
    { mcc: "5462", mccDescription: "Bakeries", sic: "5462", sicDescription: "Retail Bakeries" },
  ],
  Retail: [
    { mcc: "5999", mccDescription: "Miscellaneous and Specialty Retail", sic: "5999", sicDescription: "Retail Stores, NEC" },
    { mcc: "5411", mccDescription: "Grocery Stores, Supermarkets", sic: "5411", sicDescription: "Grocery Stores" },
    { mcc: "5651", mccDescription: "Family Clothing Stores", sic: "5651", sicDescription: "Family Clothing Stores" },
    { mcc: "5945", mccDescription: "Hobby, Toy, and Game Shops", sic: "5945", sicDescription: "Hobby, Toy Stores" },
    { mcc: "5732", mccDescription: "Electronics Stores", sic: "5732", sicDescription: "Radio, TV Stores" },
  ],
  Healthcare: [
    { mcc: "8099", mccDescription: "Health Practitioners, Medical Services", sic: "8099", sicDescription: "Health Services, NEC" },
    { mcc: "8011", mccDescription: "Doctors and Physicians", sic: "8011", sicDescription: "Offices and Clinics of Doctors" },
    { mcc: "8049", mccDescription: "Podiatrists and Chiropractors", sic: "8041", sicDescription: "Offices and Clinics of Chiropractors" },
    { mcc: "8071", mccDescription: "Dental and Medical Laboratories", sic: "8071", sicDescription: "Medical Laboratories" },
    { mcc: "5912", mccDescription: "Drug Stores and Pharmacies", sic: "5912", sicDescription: "Drug Stores" },
  ],
  Dental: [
    { mcc: "8021", mccDescription: "Dentists and Orthodontists", sic: "8021", sicDescription: "Offices and Clinics of Dentists" },
    { mcc: "8099", mccDescription: "Health Practitioners, Medical Services", sic: "8099", sicDescription: "Health Services, NEC" },
  ],
  "Med Spa": [
    { mcc: "7299", mccDescription: "Miscellaneous Personal Services", sic: "7299", sicDescription: "Services to Dwellings/Buildings" },
    { mcc: "8099", mccDescription: "Health Practitioners, Medical Services", sic: "8099", sicDescription: "Health Services, NEC" },
    { mcc: "7011", mccDescription: "Lodging — Hotels and Motels", sic: "7011", sicDescription: "Hotels and Motels" },
  ],
  "Auto Repair": [
    { mcc: "7531", mccDescription: "Auto Body Repair Shops", sic: "7531", sicDescription: "Top, Body, and Upholstery Repair" },
    { mcc: "7538", mccDescription: "Automotive Service Shops", sic: "7538", sicDescription: "General Automotive Repair" },
    { mcc: "7542", mccDescription: "Car Washes", sic: "7542", sicDescription: "Carwashes" },
    { mcc: "5533", mccDescription: "Automotive Parts and Accessories", sic: "5531", sicDescription: "Auto and Home Supply Stores" },
    { mcc: "7549", mccDescription: "Towing Services", sic: "7549", sicDescription: "Services to Motor Vehicles NEC" },
  ],
  "Salon/Beauty": [
    { mcc: "7230", mccDescription: "Barber and Beauty Shops", sic: "7231", sicDescription: "Beauty Shops" },
    { mcc: "7298", mccDescription: "Health and Beauty Spas", sic: "7299", sicDescription: "Services to Dwellings/Buildings" },
    { mcc: "5977", mccDescription: "Cosmetics Stores", sic: "5999", sicDescription: "Retail Stores, NEC" },
  ],
  "Gym/Fitness": [
    { mcc: "7941", mccDescription: "Athletic Fields, Sports Clubs, Professional Teams", sic: "7941", sicDescription: "Professional Sports Clubs" },
    { mcc: "7997", mccDescription: "Clubs, Country Clubs, and Private Golf Courses", sic: "7997", sicDescription: "Physical Fitness Facilities" },
    { mcc: "7011", mccDescription: "Lodging — Hotels and Motels (used by some gyms)", sic: "7999", sicDescription: "Amusement/Recreation Services NEC" },
  ],
  "Hotel/Lodging": [
    { mcc: "7011", mccDescription: "Lodging — Hotels and Motels", sic: "7011", sicDescription: "Hotels and Motels" },
    { mcc: "7012", mccDescription: "Timeshares", sic: "6552", sicDescription: "Land Subdividers and Developers" },
    { mcc: "7013", mccDescription: "Rooming Houses, Boarding Houses", sic: "7021", sicDescription: "Rooming and Boarding Houses" },
  ],
  Landscaping: [
    { mcc: "0780", mccDescription: "Landscaping and Horticultural Services", sic: "0781", sicDescription: "Landscape Counseling and Planning" },
    { mcc: "0742", mccDescription: "Veterinary Services for Livestock", sic: "0782", sicDescription: "Lawn and Garden Services" },
    { mcc: "1711", mccDescription: "Plumbing, Heating, Air-Conditioning Contractors", sic: "0783", sicDescription: "Ornamental Shrub/Tree Services" },
  ],
  Construction: [
    { mcc: "1520", mccDescription: "General Contractors — Residential Buildings", sic: "1521", sicDescription: "General Building Contractors" },
    { mcc: "1711", mccDescription: "Plumbing, Heating, Air-Conditioning Contractors", sic: "1711", sicDescription: "Plumbing, Heating, AC" },
    { mcc: "1731", mccDescription: "Electrical Work", sic: "1731", sicDescription: "Electrical Work" },
    { mcc: "1740", mccDescription: "Masonry, Stonework, Tile, Plastering, and Insulation", sic: "1741", sicDescription: "Masonry and Other Stonework" },
    { mcc: "1750", mccDescription: "Carpentry Contractors", sic: "1751", sicDescription: "Carpentry Work" },
    { mcc: "1761", mccDescription: "Roofing, Siding, Sheet Metal Work", sic: "1761", sicDescription: "Roofing, Siding, Sheet Metal" },
    { mcc: "1771", mccDescription: "Concrete Work", sic: "1771", sicDescription: "Concrete Work" },
    { mcc: "1799", mccDescription: "Special Trade Contractors, NEC", sic: "1799", sicDescription: "Special Trade Contractors NEC" },
  ],
  Legal: [
    { mcc: "8111", mccDescription: "Legal Services and Attorneys", sic: "8111", sicDescription: "Legal Services" },
    { mcc: "8742", mccDescription: "Management Consulting Services", sic: "8742", sicDescription: "Management Consulting Services" },
  ],
};

export function getMccCodesForVertical(vertical: string): string[] {
  const normalized = Object.keys(VERTICAL_INDUSTRY_CODES).find(
    k => k.toLowerCase() === vertical.toLowerCase() ||
         k.toLowerCase().replace(/[^a-z]/g, "") === vertical.toLowerCase().replace(/[^a-z]/g, "")
  );
  if (!normalized) return [];
  return [...new Set(VERTICAL_INDUSTRY_CODES[normalized].map(c => c.mcc).filter(Boolean) as string[])];
}

export function getSicCodesForVertical(vertical: string): string[] {
  const normalized = Object.keys(VERTICAL_INDUSTRY_CODES).find(
    k => k.toLowerCase() === vertical.toLowerCase() ||
         k.toLowerCase().replace(/[^a-z]/g, "") === vertical.toLowerCase().replace(/[^a-z]/g, "")
  );
  if (!normalized) return [];
  return [...new Set(VERTICAL_INDUSTRY_CODES[normalized].map(c => c.sic).filter(Boolean) as string[])];
}

export function detectVerticalFromMcc(mcc: string): string | null {
  for (const [vertical, codes] of Object.entries(VERTICAL_INDUSTRY_CODES)) {
    if (codes.some(c => c.mcc === mcc)) return vertical;
  }
  return null;
}

export function detectVerticalFromSic(sic: string): string | null {
  for (const [vertical, codes] of Object.entries(VERTICAL_INDUSTRY_CODES)) {
    if (codes.some(c => c.sic === sic)) return vertical;
  }
  return null;
}
