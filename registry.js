//==============================================================================
// Defines the Registry superclass
//==============================================================================

var EventEmitter = require('events').EventEmitter,
    os = require('os'),
    constants = require('./constants');

function Registry(ip, port) {
    this.ip = ip;
    this.port = port;
}

/* Registry inherits from EventEmitter */
Registry.prototype = new EventEmitter();

/**
 * returns the IPv4 address of the node
 */
Registry.prototype._getIPv4Address = function() {
    var niaddrs = os.networkInterfaces();
    for (var ni in niaddrs) {
        nielm = niaddrs[ni];
        for (n in nielm) {
            if (nielm[n].family === 'IPv4' && nielm[n].internal === false)
                return nielm[n].address
        }
    }
    return constants.globals.localhost;
}

/**
 * returns the url the node can be accessed on
 */
Registry.prototype._getUrl = function() {
    return 'tcp://' + this.ip + ':' + this.port;
}

/* exports */
module.exports = Registry;
