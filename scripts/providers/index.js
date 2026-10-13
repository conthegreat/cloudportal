import * as aws from './aws.js';
import * as azure from './azure.js';
import * as cisco from './cisco-umbrella.js';
import * as cloudflare from './cloudflare.js';
import * as gcp from './gcp.js';
import * as govwifi from './govwifi.js';
import * as oracle from './oracle.js';
import * as syntura from './syntura.js';

export const PROVIDERS = [
  { id: 'azure', name: 'Microsoft Azure', run: azure.retrieve },
  { id: 'gcp', name: 'Google Cloud Platform', run: gcp.retrieve },
  { id: 'aws', name: 'Amazon Web Services', run: aws.retrieve },
  { id: 'oracle', name: 'Oracle Cloud', run: oracle.retrieve },
  { id: 'ciscoUmbrella', name: 'Cisco Umbrella', run: cisco.retrieve },
  { id: 'cloudflare', name: 'Cloudflare', run: cloudflare.retrieve },
  { id: 'govwifi', name: 'GovWifi', run: govwifi.retrieve },
  { id: 'syntura', name: 'Syntura, formerly hSo', run: syntura.retrieve }
];
