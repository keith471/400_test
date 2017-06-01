var EventEmitter = require('events'),
    globals = require('./constants').globals,
    MQTTRegistry = require('./mqttregistry'),
    MDNSRegistry = require('./mdnsregistry'),
    LocalRegistry = require('./localregistry');

function Registrar(app, machType, id, port) {
    this.app = app;
    this.machType = machType;
    this.id = id;
    this.port = port;
    this.mqttRegistry = new MQTTRegistry(app, machType, id, port);
    this.mdnsRegistry = new MDNSRegistry(app, machType, id, port);
    this.localRegistry = new LocalRegistry(app, machType, id, port);

    // reserved attributes
    this.reservedAttrs = ['status', 'ipandport'];

    // map of id to information discovered about the node
    this.discoveries = {};

    var self = this;

    /*
     * MQTT events
     */

    this.mqttRegistry.on('mqtt-fog-up', function(fogId) {
        self.mqttRegistry.query(globals.NodeType.FOG, fogId);
    });

    this.mqttRegistry.on('mqtt-fog-ipandport', function(fog) {
        if (self._handleNodeUp(globals.Protocol.MQTT, fog.id, self)) {
            self.emit('fog-up', fog);
        }
    });

    this.mqttRegistry.on('mqtt-fog-down', function(fogId) {
        if (self._handleNodeDown(globals.Protocol.MQTT, fogId, self)) {
            self.emit('fog-down', fogId);
        }
    });

    this.mqttRegistry.on('mqtt-cloud-up', function(cloudId) {
        if (self._handleNodeUp(globals.Protocol.MQTT, cloudId, self)) {
            self.mqttRegistry.query(globals.NodeType.CLOUD, cloudId);
        }
    });

    this.mqttRegistry.on('mqtt-cloud-ipandport', function(cloud) {
        self.emit('cloud-up', cloud);
    });

    this.mqttRegistry.on('mqtt-cloud-down', function(cloudId) {
        if (self._handleNodeDown(globals.Protocol.MQTT, cloudId, self)) {
            self.emit('cloud-down', cloudId);
        }
    });

    this.mqttRegistry.on('mqtt-error', function() {
        // mqtt cleanup
        self.mqttRegistry.quit(function() {
            setTimeout(self._retry, globals.retryInterval, self, globals.Protocol.MQTT);
        });
    });

    /*
     * mDNS events
     */

    /* triggered when a fog goes up */
    this.mdnsRegistry.on('mdns-fog-up', function(fog) {
        if (self._handleNodeUp(globals.Protocol.MDNS, fog.id, self)) {
            console.log('mdns says fog up');
            self.emit('fog-up', fog);
        }
    });

    /* triggered when a fog goes down */
    this.mdnsRegistry.on('mdns-fog-down', function(fogId) {
        if (self._handleNodeDown(globals.Protocol.MDNS, fogId, self)) {
            self.emit('fog-down', fogId);
        }
    });

    /* triggered when a cloud goes up */
    this.mdnsRegistry.on('mdns-cloud-up', function(cloud) {
        if (self._handleNodeUp(globals.Protocol.MDNS, cloud.id, self)) {
            self.emit('cloud-up', cloud);
        }
    });

    /* triggered when a cloud goes down */
    this.mdnsRegistry.on('mdns-cloud-down', function(cloudId) {
        if (self._handleNodeDown(globals.Protocol.MDNS, cloudId, self)) {
            self.emit('cloud-down', cloudId);
        }
    });

    this.mdnsRegistry.on('mdns-ad-error', function() {
        // mdns cleanup
        self.mdnsRegistry.quit();
        setTimeout(self._retry, globals.retryInterval, self, globals.Protocol.MDNS);
    });

    this.mdnsRegistry.on('mdns-ad-success', function() {
        console.log('mdns success');
    });

    /*
     * Local storage events
     */

    /* triggered when a fog (or fogs) updates the local storage */
    this.localRegistry.on('ls-fog-update', function(updates) {
        for (var i in updates.online) {
            if (self._handleNodeUp(globals.Protocol.LOCALSTORAGE, updates.online[i].id, self)) {
                console.log('local storage says fog up');
                self.emit('fog-up', updates.online[i]);
            }
        }
        for (var i in updates.offline) {
            if (self._handleNodeDown(globals.Protocol.LOCALSTORAGE, updates.offline[i], self)) {
                self.emit('fog-down', updates.offline[i]);
            }
        }
    });

    /* triggered when a cloud (or clouds) updates the local storage */
    this.localRegistry.on('ls-cloud-update', function(updates) {
        for (var i in updates.online) {
            if (self._handleNodeUp(globals.Protocol.LOCALSTORAGE, updates.online[i].id, self)) {
                self.emit('cloud-up', updates.online[i]);
            }
        }
        for (var i in updates.offline) {
            if (self._handleNodeDown(globals.Protocol.LOCALSTORAGE, updates.offline[i], self)) {
                self.emit('cloud-down', updates.offline[i]);
            }
        }
    });

    this.localRegistry.on('ls-reg-success', function() {
        console.log('ls success');
    });

    this.mqttRegistry.on('custom-discovery', function(emit, nodeId, value) {
        self.emit(emit, nodeId, value);
    });

    this.mdnsRegistry.on('custom-discovery', function(emit, nodeId, value) {
        self.emit(emit, nodeId, value);
    });

    this.localRegistry.on('custom-discovery', function(emit, nodeId, value) {
        self.emit(emit, nodeId, value);
    });
}

/* Registrar inherits from EventEmitter */
Registrar.prototype = new EventEmitter();

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

Registrar.prototype._handleNodeUp = function(protocol, id, self) {
    if (self.discoveries.hasOwnProperty(id)) {
        // avoid repeat discoveries
        if (self.discoveries[id].status !== globals.Status.ONLINE) {
            self.discoveries[id].status = globals.Status.ONLINE;
            self.discoveries[id].protocol = protocol;
            return true;
        } else if (protocol > self.discoveries[id].protocol) {
            // could already be online but according to a lower protocol
            // we want to update the protocol we have recorded for this node
            self.discoveries[id].protocol = protocol;
        }
    } else {
        self.discoveries[id] = { status: globals.Status.ONLINE, protocol: protocol };
        return true;
    }
    return false;
}

Registrar.prototype._handleNodeDown = function(protocol, id, self) {
    if (self.discoveries.hasOwnProperty(id)) {
        if (self.discoveries[id].status !== globals.Status.OFFLINE) {
            self.discoveries[id].status = globals.Status.OFFLINE;
            return true;
        }
    } else {
        self.discoveries[id] = { status: globals.Status.OFFLINE, protocol: protocol };
        return true;
    }
    return false;
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
 * Add a custom, discoverable attributes to this node
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
        throw new Error('attrs must be an object');
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
        if (typeof attrs[key] != 'string') {
            throw new Error('the event name\'' + attrs[key] + '\' must be a string')
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
