const fs = require('fs');

let content = fs.readFileSync('wrangler.jsonc', 'utf8');

const kvConfig = `	"kv_namespaces": [
		{
			"binding": "MEGAHAL_KV",
			"id": "12345678901234567890123456789012"
		}
	],
`;

content = content.replace('"upload_source_maps": true', '"upload_source_maps": true,');
content = content.replace('// "placement": {  "mode": "smart" }', '// "placement": {  "mode": "smart" },');
content = content.replace('/**\n\t * Bindings', kvConfig + '	/**\n\t * Bindings');

fs.writeFileSync('wrangler.jsonc', content);
