const { execFile } = require('child_process');
const fs  = require('fs');
const path = require('path');

const generatePolar = require('./parse_polar');

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
      // run parse_logbook.js with the log directory
      execFile('node', [path.join(__dirname, 'parse_logbook.js'), LOG_DIR], (err, stdout, stderr) => {
        if (err) {
          app.error(`Failed to generate voyages: ${stderr}`);
          res.status(500).send({message: 'Error running parser'});
          return;
        }
        try {
          const voyagesData = JSON.parse(stdout);
          const voyagesJson = JSON.stringify(voyagesData, null, 2);
          const polarData = generatePolar(voyagesData);
          const polarJson = JSON.stringify(polarData, null, 2);

          fs.writeFileSync(OUTPUT_JSON, voyagesJson);
          fs.writeFileSync(OUTPUT_POLAR, polarJson);
          res.json({ status: 'ok' });
        } catch (writeErr) {
          app.error(`Failed to process voyages output: ${writeErr.message}`);
          res.status(500).send({message: 'Error processing parser output'});
        }
      });
    });

    // GET /generate/polar – regenerate polar data using the existing voyages.json
    router.get('/generate/polar', (req, res) => {
      fs.readFile(OUTPUT_JSON, 'utf8', (readErr, contents) => {
        if (readErr) {
          app.error(`Failed to read voyages.json: ${readErr.message}`);
          res.status(500).send({message: 'Could not read voyages data'});
          return;
        }

        try {
          const voyagesData = JSON.parse(contents);
          const polarData = generatePolar(voyagesData);
          const polarJson = JSON.stringify(polarData, null, 2);
          fs.writeFile(OUTPUT_POLAR, polarJson, writeErr => {
            if (writeErr) {
              app.error(`Failed to write Polar.json: ${writeErr.message}`);
              res.status(500).send({message: 'Could not write polar data'});
              return;
            }
            res.json({ status: 'ok' });
          });
        } catch (parseErr) {
          app.error(`Failed to generate polar data: ${parseErr.message}`);
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
