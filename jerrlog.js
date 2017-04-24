//==========================================================
// error handling
//==========================================================

//===========================================
// Private
//===========================================
var bunyan = require('bunyan');

//===========================================
// Public
//===========================================
module.exports = {

    log: null,

    init: function(app, printToStderr) {
        var streams = [{ path: './logs/log.log' }];
        if (printToStderr) {
            streams.push({ stream: process.stderr });
        }
        module.exports.log = bunyan.createLogger({
            name: app,
            streams: streams
        });
    }
}
