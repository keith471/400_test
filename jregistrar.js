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

    // map of id to information discovered about the node
    this.discoveries = {};

    var self = this;

    /*
     * MQTT events
     */

    this.mqttRegistry.on('mqtt-fog-up', function(fogId) {
        if (self._handleNodeUp(globals.Protocol.MQTT, fogId, self)) {
            self.mqttRegistry.query(globals.NodeType.FOG, fogId);
        }
    });

    this.mqttRegistry.on('mqtt-fog-ipandport', function(fog) {
        // this will only be fired (eventually) if a query is made, and a query will be made only if a fog has gone from
        // offline to online, and thus we can safely emit a 'fog-up' event without risk of emitting a repeat event
        self.emit('fog-up', fog);
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

    this.mqttRegistry.on('mqtt-reg-error', function() {
        // mqtt cleanup
        self.mqttRegistry.quit(function() {
            setTimeout(self._retry, globals.retryInterval, self, globals.Protocol.MQTT);
        });
    });

    this.mqttRegistry.on('mqtt-reg-success', function() {
        console.log('mqtt success');
    });

    /*
     * mDNS events
     */

    /* triggered when a fog goes up */
    this.mdnsRegistry.on('mdns-fog-up', function(fog) {
        if (self._handleNodeUp(globals.Protocol.MDNS, fog.id, self)) {
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
}

/* Registrar inherits from EventEmitter */
Registrar.prototype = new EventEmitter();

/**
 * Register a node on the network, and discover other nodes.
 * A node will always attempt to register using MQTT first.
 * If this fails, then it will fall back on mDNS.
 * If mDNS also fails, then it will fall back on local storage.
 */
Registrar.prototype.registerAndDiscover = function() {
    this.mqttRegistry.registerAndDiscover();
    this.mdnsRegistry.registerAndDiscover();
    this.localRegistry.registerAndDiscover();
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
        // if we receive an event indicating that a node is down on a given protocol, then we had better
        // have the node currently recorded as up on the same protocol, otherwise we ignore
        if (protocol === self.discoveries[id].protocol && self.discoveries[id].status !== globals.Status.OFFLINE) {
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

/* exports */
module.exports = Registrar;
