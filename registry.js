//==============================================================================
// Defines the Registry superclass
//==============================================================================

var EventEmitter = require('events').EventEmitter,
    constants = require('./constants');

function Registry(app, machType, id, port) {
    this.app = app;
    this.machType = machType;
    this.id = id;
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
Registry.prototype = Object.create(EventEmitter.prototype);
Registry.prototype.constructor = Registry;

/* exports */
module.exports = Registry;
