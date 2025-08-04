const { execFile } = require('child_process');
const fs  = require('fs');
const path = require('path');

// adjust this path if your logs live elsewhere
const LOG_DIR = path.join(process.env.HOME, '.signalk', 'plugin-config-data', 'signalk-logbook');
const OUTPUT_JSON = path.join(__dirname, 'public', 'voyages.json');

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
          fs.writeFileSync(OUTPUT_JSON, stdout);
          res.json({ status: 'ok' });
        } catch (writeErr) {
          res.status(500).send({message: writeErr.message});
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
