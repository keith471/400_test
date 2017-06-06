//==============================================================================
// Defines the Registry superclass
//==============================================================================

var EventEmitter = require('events').EventEmitter,
    constants = require('./constants');

function Registry(ip, port) {
    this.ip = ip;
    this.port = port;

    // discoverable attributes of the node
    this.attributes = {};

    // attributes of other nodes that this node is discovering
    this.attributesToDiscover = {
        device: {},
        fog: {},
        cloud: {}
    };
}

/* Registry inherits from EventEmitter */
Registry.prototype = new EventEmitter();

/**
 * returns the url the node can be accessed on
 */
Registry.prototype.getUrl = function() {
    return 'tcp://' + this.ip + ':' + this.port;
}

/* exports */
module.exports = Registry;
