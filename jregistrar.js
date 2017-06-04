var EventEmitter = require('events'),
    globals = require('./constants').globals,
    MQTTRegistry = require('./mqttregistry'),
    MDNSRegistry = require('./mdnsregistry'),
    LocalRegistry = require('./localregistry'),
    Registry = require('./registry');

//==============================================================================
// Helpers
//==============================================================================

/**
 * Returns true if two values are equivalent and false otherwise
 */
function equivalentValues(a, b) {
    // base cases
    if ((typeof a == 'number' && typeof b == 'number') ||
        (typeof a == 'string' && typeof b == 'string')) {
            return a == b;
    }

    if ((a == null && b == null) ||
        (a == undefined && b == undefined)) {
            return true;
        }
    }

    if (a instanceof Array && b instanceof Array) {
        // recursive case 1
        return equivalentArrays(a, b);
    } else if (a instanceof Object && b instanceof Object) {
        // recursive case 2
        return equivalentObjects(a, b);
    }

    return false;
}

/**
 * Returns true if two arrays are equivalent or false otherwise
 * Note: Currently returns false for two arrays with the same elements but in a different order
 */
function equivalentArrays(a, b) {
    if (a.length != b.length) {
        return false;
    }

    for (var i = 0; i < a.length; i++) {
        if (!equivalentValues(a[i], b[i])) {
            return false;
        }
    }

    return true;
}

/**
 * Returns true if two objects are equivalent and false otherwise
 */
function equivalentObjects(a, b) {
    if (Object.keys(a).length != Object.keys(b).length) {
        return false;
    }

    for (var key in a) {
        if (!b.hasOwnProperty(key) || !equivalentValues(a[key], b[key])) {
            return false;
        }
    }

    return true;
}

//==============================================================================
// Registrar Class
// This Class is the interface between the application and the MQTT, mDNS, and
// local storage registries
//==============================================================================

function Registrar(app, machType, id, port) {
    this.app = app;
    this.machType = machType;
    this.id = id;
    this.port = port;
    this.mqttRegistry = new MQTTRegistry(app, machType, id, port);
    this.mdnsRegistry = new MDNSRegistry(app, machType, id, port);
    this.localRegistry = new LocalRegistry(app, machType, id, port);

    // store discoveries here so that we can easily check for duplicates
    this.discoveries = {};

    // reserved attributes
    this.reservedAttrs = ['status', 'ip', 'port', 'lastCheckIn', 'createdAt'];

    // set up default attributes, which are the same for devices, fogs, and clouds (i.e. just status)
    // default attributes:
    // status
    var attrs = {
        status: function() {
            return {
                port: port,
                ip: Registrar.getIPv4Address();
            };
        }
    };
    this.mqttRegistry.addAttributes(attrs);
    this.mdnsRegistry.addAttributes(attrs);
    this.localRegistry.addAttributes(attrs);

    // prep the default discoveries to be made by a node:
    // devices discover fogs and fogs discover clouds
    if (this.machType === globals.NodeType.DEVICE) {
        // default discoveries:
        // devices discover fogs
        var disc = {
            fog: {
                status: {
                    online: 'fog-up',
                    offline: 'fog-down'
                    // if the status value is `offline`, then we emit fog-down, else we emit fog-up
                }
            }
        };
        this.mqttRegistry.discoverAttributes(disc);
        this.mdnsRegistry.discoverAttributes(disc);
        this.localRegistry.discoverAttributes(disc);
    } else if (this.machType === globals.NodeType.FOG) {
        // default discoveries:
        // fogs discover clouds
        var disc = {
            cloud: {
                status: {
                    online: 'cloud-up',
                    offline: 'cloud-down'
                }
            }
        };
        this.mqttRegistry.discoverAttributes(disc);
        this.mdnsRegistry.discoverAttributes(disc);
        this.localRegistry.discoverAttributes(disc);
    } else {
        // no default cloud discoveries
    }

    // listen for events from the Registries

    var self = this;

    this.mqttRegistry.on('error', function() {
        // mqtt cleanup
        self.mqttRegistry.quit(function() {
            setTimeout(self._retry, globals.retryInterval, self, globals.Protocol.MQTT);
        });
    });

    this.mdnsRegistry.on('error', function() {
        // mdns cleanup
        self.mdnsRegistry.quit();
        setTimeout(self._retry, globals.retryInterval, self, globals.Protocol.MDNS);
    });

    this.mdnsRegistry.on('ad-success', function() {
        console.log('mdns success');
    });

    this.mqttRegistry.on('discovery', function(attr, event, nodeId, value) {
        self._respondToDiscoveryEvent(self, attr, event, nodeId, value);
    });

    this.mdnsRegistry.on('discovery', function(attr, event, nodeId, value) {
        self._respondToDiscoveryEvent(self, attr, event, nodeId, value);
    });

    this.localRegistry.on('discovery', function(attr, event, nodeId, value) {
        self._respondToDiscoveryEvent(self, attr, event, nodeId, value);
    });
}

/* Registrar inherits from EventEmitter */
Registrar.prototype = new EventEmitter();

Registrar.prototype._respondToDiscoveryEvent = function(self, attr, event, nodeId, value) {
    /*
    if (event instanceof Object) {
        // check that value is an object with tag and value fields
        if (value instanceof Object) {
            // tag field
            if (!value.hasOwnProperty('tag')) {
                throw new Error('value does not have tag field as expected');
            } else  {
                if (typeof value.tag != 'string') {
                    throw new Error('value\'s tag field must be a string');
                }
            }
            // value field
            if (!value.hasOwnProperty('value')) {
                throw new Error('value does not have value field as expected');
            }
        } else {
            throw Error('value not an object as expected');
        }

        // if uncommented, need to go through and fix this
        if (!self._isDuplicate(self, attr, nodeId, value)) {
            self._updateDiscoveries(self, attr, nodeId, value);
            self.emit(event.events[value].tag, nodeId, value.value);
        }
    } else {
        if (!self._isDuplicate(self, attr, nodeId, value)) {
            self._updateDiscoveries(self, event, nodeId, value);
            self.emit(event, nodeId, value);
        }
    }
    */

    if (!self._isDuplicate(self, attr, nodeId, value)) {
        self._updateDiscoveries(self, attr, nodeId, value);
        self.emit(event, nodeId, value);
    }
}

/**
 * Returns true if a discovery is a duplicate and false otherwise
 */
Registrar.prototype._isDuplicate = function(self, attr, nodeId, value) {
    if (!self.discoveries.hasOwnProperty(attr)) {
        return false;
    }

    if (!self.discoveries[attr].hasOwnProperty(nodeId)) {
        return false;
    }

    // compare the values
    return equivalentValues(value, self.discoveries[attr][nodeId]);
}

Registrar.prototype._updateDiscoveries = function(self, attr, nodeId, value) {
    if (!self.discoveries.hasOwnProperty(attr)) {
        self.discoveries[attr] = {};
    }
    self.discoveries[attr][nodeId] = value;
}

/**
 * Register a node on the network, and discover other nodes.
 * A node will always attempt to register using MQTT first.
 * If this fails, then it will fall back on mDNS.
 * If mDNS also fails, then it will fall back on local storage.
 * options - an optional parameter
 * options include:
 *   attributes: key/value pair as in addAttributes
 *   discoverAttributes: as in discoverAttributes
 */
Registrar.prototype.registerAndDiscover = function(options) {
    if (options !== undefined) {
        if (typeof options !== 'object') {
            throw new Error('options must be an object - see the docs');
        }

        if (options.attributes !== undefined) {
            this._checkAttributes(options.attributes);
        }

        if (options.discoverAttributes !== undefined) {
            options.discoverAttributes = this._checkAndReformatDiscoverAttributes(options.discoverAttributes);
        }
    }
    this.mqttRegistry.registerAndDiscover(options);
    this.mdnsRegistry.registerAndDiscover(options);
    this.localRegistry.registerAndDiscover(options);
}

Registrar.prototype._retry = function(self, protocol) {
    if (protocol === globals.Protocol.MQTT) {
        console.log('retrying mqtt');
        self.mqttRegistry.registerAndDiscover();
    } else if (protocol === gloabals.Protocol.MDNS) {
        console.log('retrying mdns');
        self.mdnsRegistry.registerAndDiscover();
    }
}

//==============================================================================
// Custom registration and discovery
//==============================================================================

/**
 * Add custom, discoverable attributes to this node
 * attrs is an object of key value pairs
 */
Registrar.prototype.addAttributes = function(attrs) {
    // error handling
    this._checkAttributes(attrs);
    // add the attributes on each protocol
    this.mqttRegistry.addAttributes(attrs);
    this.mdnsRegistry.addAttributes(attrs);
    this.localRegistry.addAttributes(attrs);
}

/**
 * Specify attributes to be discovered
 attrs can have one of the following forms:
 (a)
    {
        all: {attr: event}, // discover these attributes for all nodes
        device: {attr: event}, // discover these attributes just for devices
        fog: {attr: event}, // discover these attributes just for fogs
        cloud: {attr: event} // discover these attributes just for clouds
    }
 (b) As a shortcut for all, one can simply pass an object of <attr, event> pairs
 */
Registrar.prototype.discoverAttributes = function(attrs) {
    attrs = this._checkAndReformatDiscoverAttributes(attrs);
    this.mqttRegistry.discoverAttributes(formedAttrs);
    this.mdnsRegistry.discoverAttributes(formedAttrs);
    this.localRegistry.discoverAttributes(formedAttrs);
}

Registrar.prototype._checkAndReformatDiscoverAttributes = function(attrs) {
    // error handling
    if (typeof attrs !== 'object') {
        throw new Error('you must specity the attributes you want discovered as an object - see the docs');
    }
    // check that the attrs parameter is properly formed
    var formedAttrs;
    if (attrs.all === undefined &&
        attrs.device === undefined &&
        attrs.fog === undefined &&
        attrs.cloud === undefined) {
            this._checkForm(attrs);
            formedAttrs = {
                device: {},
                fog: {},
                cloud: {}
            };
            for (var key in attrs) {
                formedAttrs.device[key] = attrs[key];
                formedAttrs.fog[key] = attrs[key];
                formedAttrs.cloud[key] = attrs[key];
            }
    } else {
        this._checkForm(attrs.all);
        this._checkForm(attrs.device);
        this._checkForm(attrs.fog);
        this._checkForm(attrs.cloud);
        for (var key in attrs.all) {
            attrs.device[key] = attrs.all[key];
            attrs.fog[key] = attrs.all[key];
            attrs.cloud[key] = attrs.all[key];
        }
        formedAttrs = attrs;
    }
    return formedAttrs;
}

/**
 * A helper for Registrar.prototype.discoverAttributes;
 * ensures that attrs is an object of <string, string> pairs
 */
Registrar.prototype._checkForm = function(attrs) {
    for (var key in attrs) {
        if (key == 'status') {
            // ensure that online and offline events are specified
            if (!attrs.status instanceof Object) {
                throw new Error('discovery of the status attribute requires online and offline event names, passed in an object - see the docs');
            }

            // online
            if (!attrs.status.hasOwnProperty('online')) {
                throw new Error('online event required for discovery of status attribute');
            } else {
                if (typeof attrs.status.online != 'string') {
                    throw new Error('the event name \'' + attrs.status.online + '\' must be a string');
                }
            }

            // offline
            if (!attrs.status.hasOwnProperty('offline')) {
                throw new Error('offline event required for discovery of status attribute');
            } else {
                if (typeof attrs.status.offline != 'string') {
                    throw new Error('the event name \'' + attrs.status.offline + '\' must be a string');
                }
            }
        } else if (typeof attrs[key] != 'string') {
            throw new Error('the event name \'' + attrs[key] + '\' must be a string')
        }
    }
}

Registrar.prototype._checkAttributes = function(attrs) {
    if (typeof attrs !== 'object') {
        throw new Error('attrs must be an object');
    }
    for (var i = 0; i < this.reservedAttrs.length; i++) {
        if (attrs[this.reservedAttrs[i]] !== undefined) {
            throw new Error('the attribute \'' + this.reservedAttrs[i] + '\' is reserved');
        }
    }
}

/* exports */
module.exports = Registrar;
