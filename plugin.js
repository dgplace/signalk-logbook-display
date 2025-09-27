const { execFile } = require('child_process');
const fs  = require('fs');
const path = require('path');

const generatePolar = require('./parse_polar');

const MAX_LOG_SNIPPET = 400;

function logSnippet(label, content, logger) {
  if (!content) return;
  const payload = content.length > MAX_LOG_SNIPPET
    ? `${content.slice(0, MAX_LOG_SNIPPET)}… (truncated ${content.length - MAX_LOG_SNIPPET} chars)`
    : content;
  logger(`${label}${payload}`);
}

// adjust this path if your logs live elsewhere
const LOG_DIR = path.join(process.env.HOME, '.signalk', 'plugin-config-data', 'signalk-logbook');
const OUTPUT_JSON = path.join(__dirname, 'public', 'voyages.json');
const OUTPUT_POLAR = path.join(__dirname, 'public', 'Polar.json');

module.exports = function(app) {
  const plugin = {};
  plugin.id = 'voyage-webapp';
  plugin.name = 'Voyage Webapp';

  plugin.start = () => {
    // nothing to initialise
  };
  plugin.stop = () => {
    // nothing to clean up
  };

  plugin.registerWithRouter = router => {
    // GET /generate – run the parser and save voyages.json
    router.get('/generate', (req, res) => {
      const targetUrl = req.originalUrl || req.url || '/generate';
      app.debug(`[voyage-webapp] GET ${targetUrl} -> running parser with log dir ${LOG_DIR}`);
      const scriptPath = path.join(__dirname, 'parse_logbook.js');
      execFile('node', [scriptPath, LOG_DIR], (err, stdout, stderr) => {
        if (err) {
          app.error(`[voyage-webapp] parse_logbook.js failed (code=${err.code ?? 'n/a'} signal=${err.signal ?? 'n/a'}): ${err.message}`);
          logSnippet('[voyage-webapp] parser stderr: ', stderr, msg => app.error(msg));
          logSnippet('[voyage-webapp] parser stdout: ', stdout, msg => app.error(msg));
          res.status(500).send({message: 'Error running parser'});
          return;
        }
        logSnippet('[voyage-webapp] parser stdout: ', stdout, msg => app.debug(msg));
        try {
          const voyagesData = JSON.parse(stdout);
          const voyagesJson = JSON.stringify(voyagesData, null, 2);
          const polarData = generatePolar(voyagesData);
          const polarJson = JSON.stringify(polarData, null, 2);

          fs.writeFileSync(OUTPUT_JSON, voyagesJson);
          fs.writeFileSync(OUTPUT_POLAR, polarJson);
          app.debug('[voyage-webapp] Successfully wrote voyages.json and Polar.json');
          res.json({ status: 'ok' });
        } catch (writeErr) {
          app.error(`[voyage-webapp] Failed to process voyages output: ${writeErr.message}`);
          logSnippet('[voyage-webapp] raw stdout: ', stdout, msg => app.error(msg));
          res.status(500).send({message: 'Error processing parser output'});
        }
      });
    });

    // GET /generate/polar – regenerate polar data using the existing voyages.json
    router.get('/generate/polar', (req, res) => {
      const targetUrl = req.originalUrl || req.url || '/generate/polar';
      app.debug(`[voyage-webapp] GET ${targetUrl} -> regenerating polar from existing voyages.json`);
      fs.readFile(OUTPUT_JSON, 'utf8', (readErr, contents) => {
        if (readErr) {
          app.error(`[voyage-webapp] Failed to read voyages.json: ${readErr.message}`);
          res.status(500).send({message: 'Could not read voyages data'});
          return;
        }

        try {
          const voyagesData = JSON.parse(contents);
          const polarData = generatePolar(voyagesData);
          const polarJson = JSON.stringify(polarData, null, 2);
          fs.writeFile(OUTPUT_POLAR, polarJson, writeErr => {
            if (writeErr) {
              app.error(`[voyage-webapp] Failed to write Polar.json: ${writeErr.message}`);
              res.status(500).send({message: 'Could not write polar data'});
              return;
            }
            app.debug('[voyage-webapp] Successfully rewrote Polar.json from existing voyages.json');
            res.json({ status: 'ok' });
          });
        } catch (parseErr) {
          app.error(`[voyage-webapp] Failed to generate polar data: ${parseErr.message}`);
          res.status(500).send({message: 'Could not process voyages data'});
        }
      });
    });
  };

  // add an empty configuration schema
  plugin.schema = {
    type: 'object',
    properties: {},
    additionalProperties: false
  };

  return plugin;
};
