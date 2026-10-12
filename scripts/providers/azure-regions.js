export const AZURE_REGION_PHRASES = [
  ['UK South', 'uksouth'],
  ['UK West', 'ukwest'],
  ['East US 2', 'eastus2'],
  ['East US', 'eastus'],
  ['West US 3', 'westus3'],
  ['West US 2', 'westus2'],
  ['West US', 'westus'],
  ['Central US', 'centralus'],
  ['North Central US', 'northcentralus'],
  ['South Central US', 'southcentralus'],
  ['West Central US', 'westcentralus'],
  ['Canada Central', 'canadacentral'],
  ['Canada East', 'canadaeast'],
  ['Brazil South', 'brazilsouth'],
  ['Brazil Southeast', 'brazilsoutheast'],
  ['North Europe', 'northeurope'],
  ['West Europe', 'westeurope'],
  ['France Central', 'francecentral'],
  ['France South', 'francesouth'],
  ['Germany West Central', 'germanywestcentral'],
  ['Germany North', 'germanynorth'],
  ['Norway East', 'norwayeast'],
  ['Norway West', 'norwaywest'],
  ['Switzerland North', 'switzerlandnorth'],
  ['Switzerland West', 'switzerlandwest'],
  ['Sweden Central', 'swedencentral'],
  ['Sweden South', 'swedensouth'],
  ['Poland Central', 'polandcentral'],
  ['Italy North', 'italynorth'],
  ['Spain Central', 'spaincentral'],
  ['Austria East', 'austriaeast'],
  ['Belgium Central', 'belgiumcentral'],
  ['East Asia', 'eastasia'],
  ['Southeast Asia', 'southeastasia'],
  ['Japan East', 'japaneast'],
  ['Japan West', 'japanwest'],
  ['Korea Central', 'koreacentral'],
  ['Korea South', 'koreasouth'],
  ['Australia East', 'australiaeast'],
  ['Australia Southeast', 'australiasoutheast'],
  ['Australia Central', 'australiacentral'],
  ['Central India', 'centralindia'],
  ['South India', 'southindia'],
  ['West India', 'westindia'],
  ['UAE North', 'uaenorth'],
  ['UAE Central', 'uaecentral'],
  ['South Africa North', 'southafricanorth'],
  ['South Africa West', 'southafricawest'],
  ['Qatar Central', 'qatarcentral'],
  ['Israel Central', 'israelcentral'],
  ['Mexico Central', 'mexicocentral'],
  ['Chile Central', 'chilecentral']
];

const PHRASES = AZURE_REGION_PHRASES.slice().sort((left, right) => right[0].length - left[0].length);

export function extractAzureRegions(text) {
  const source = String(text || '');
  let remaining = ` ${source} `;
  const found = [];
  for (const [phrase, id] of PHRASES) {
    const pattern = new RegExp(`\\b${phrase.replace(/ /g, '\\s+')}\\b`, 'ig');
    if (pattern.test(remaining)) {
      found.push(id);
      remaining = remaining.replace(pattern, ' ');
    }
  }
  for (const [, id] of PHRASES) {
    if (new RegExp(`\\b${id}\\b`, 'i').test(source)) found.push(id);
  }
  return [...new Set(found)];
}

export function azureIsExplicitlyGlobal(text) {
  return /\bnon[-\s]?regional\b/i.test(text) || /\ball regions\b/i.test(text);
}
