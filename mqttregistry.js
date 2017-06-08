//==============================================================================
// Registers a node on the network using MQTT
//==============================================================================

var mqtt = require('mqtt'),
    logger = require('./jerrlog.js'),
    constants = require('./constants'),
    Registry = require('./registry');

function MQTTRegistry(app, machType, id, port, subQos, pubQos) {
    Registry.call(this, app, machType, id, port);
    // the quality of service to use for subscriptions
    this.subQos = subQos;
    // the quality of service to use for publications
    this.pubQos = pubQos;

    // attributes that have already been published
    this.publishedAttrs = {};
    // attributes that have already been subscribed to
    this.subscribedAttrs = {
        device: {},
        fog: {},
        cloud: {}
    };
    // attributes to be published on (re)connection
    this.attrsToPublish = {};
    // attributes to remove when reconnecting
    this.attrsToRemove = {};
    // attributes to subscribe to on (re)connection
    this.attrsToSubTo = {
        device: {},
        fog: {},
        cloud: {}
    }
    // attributes to unsubscribe from on reconnection
    this.attrsToUnsubFrom = {
        device: {},
        fog: {},
        cloud: {}
    }
}

/* MQTTRegistry inherits from Registry */
MQTTRegistry.prototype = Object.create(Registry.prototype);
MQTTRegistry.prototype.constructor = MQTTRegistry;

/**
 * Performs basic registration and discovery
 * Designed to be called multiple times if need be
 */
MQTTRegistry.prototype.registerAndDiscover = function(options) {


    for (var key in this.attributes) {
        // ensure that we republish any attributes determined by a function, for example, status
        if (this.attributes[key] instanceof Function) {
            if (newAttrs === null) {
                newAttrs = {};
            }
            newAttrs[key] = this.attributes[key];
        }
        oldAttrs[key] = this.attributes[key];
    }


    for (var key in this.attributesToDiscover.device) {
        oldSubs[this.app + '/device/+/' + key] = this.subQos;
    }

    for (var key in this.attributesToDiscover.fog) {
        oldSubs[this.app + '/fog/+/' + key] = this.subQos;
    }

    for (var key in this.attributesToDiscover.cloud) {
        oldSubs[this.app + '/cloud/+/' + key] = this.subQos;
    }

    if (options !== undefined) {
        // parse options
        // attributes
        for (var key in options.attributes) {
            // add to this.attributes
            this.attributes[key] = options.attributes[key];
            // add to newAttrs
            if (newAttrs === null) {
                newAttrs = {};
            }
            newAttrs[key] = options.attributes[key];
        }

        // attributesToDiscover
        for (var key in options.attributesToDiscover.device) {
            // add to this.attributesToDiscover
            this.attributesToDiscover.device[key] = options.attributesToDiscover.device[key];
            // add to newSubs
            if (newSubs === null) {
                newSubs = {};
            }
            newSubs[this.app + '/device/+/' + key] = this.subQos;
        }

        for (var key in options.attributesToDiscover.fog) {
            this.attributesToDiscover.fog[key] = options.attributesToDiscover.fog[key];
            if (newSubs === null) {
                newSubs = {};
            }
            newSubs[this.app + '/fog/+/' + key] = this.subQos;
        }

        for (var key in options.attributesToDiscover.cloud) {
            this.attributesToDiscover.cloud[key] = options.attributesToDiscover.cloud[key];
            if (newSubs === null) {
                newSubs = {};
            }
            newSubs[this.app + '/cloud/+/' + key] = this.subQos;
        }
    }

    // create an mqtt client
    this.client = mqtt.connect(constants.mqtt.brokerUrl, this._getConnectionOptions());

    // set up event listeners for the client
    this._prepareForEvents(newSubs, oldSubs, newAttrs, oldAttrs);
}

/**
 * A general helper for listening for events from the MQTT client
 */
MQTTRegistry.prototype._prepareForEvents = function(newSubs, oldSubs, newAttrs, oldAttrs) {
    var self = this;

    /* connect event emitted on successful connection or reconnection */
    this.client.on('connect', function (connack) {
        // if first connection, then set up subscriptions
        if (!connack.sessionPresent) {
            // make subscriptions
            if (newSubs !== null) {
                // add newSubs to oldSubs
                for (var key in newSubs) {
                    oldSubs[key] = newSubs[key];
                }
            }
            self._subscribeWithRetries(self, oldSubs, constants.mqtt.retries, function(granted) {
                logger.log.info(self.machType + ' ' + self.id + ' subscribed to ' + JSON.stringify(granted));
                // make publications
                if (newAttrs !== null) {
                    // add new attrs to old attrs
                    for (var key in newAttrs) {
                        oldAttrs[key] = newAttrs[key];
                    }
                }
                self._publishWithRetries(self, oldAttrs, constants.mqtt.retries);
            });
        } else {
            // our connection is already present, meaning that the broker is still aware of our old subscriptions
            // so, we make the new ones and then publish the new attrs (or at the very least, an online status)
            // we also need to make null publications for any attrsToRemove and
            // we need to unsubscribe from any topicsToUnsubscribeFrom
            if (newSubs !== null) {
                self._subscribeWithRetries(self, newSubs, constants.mqtt.retries, function(granted) {
                    logger.log.info(self.machType + ' ' + self.id + ' subscribed to ' + JSON.stringify(granted));
                    // make publications
                    if (newAttrs === null) {
                        newAttrs = {};
                    }
                    self._publishWithRetries(self, newAttrs, constants.mqtt.retries);
                    // make null publications for any attributes to remove
                    self._publishWithRetries(self, self.attrsToRemove, constants.mqtt.retries, function(err) {
                        if (!err) {
                            // reset attrsToRemove
                            self.attrsToRemove = {};
                        }
                    });
                    // unsubscribe from things if needed
                    self._unsubscribe(self, self.topicsToUnsubscribeFrom, function(err) {
                        if (!err) {
                            // reset topicsToUnsubscribeFrom
                            self.topicsToUnsubscribeFrom = [];
                        }
                    });
                });
            } else {
                if (newAttrs === null) {
                    newAttrs = {};
                }
                self._publishWithRetries(self, newAttrs, constants.mqtt.retries);
            }
        }
    });

    /* message event received when client receives a published packet */
    this.client.on('message', function (topic, message, packet) {
        var parsedMsg = JSON.parse(message.toString());
        if (parsedMsg !== null) {
            self._handleMessage(self, topic, parsedMsg.payload);
        }
    });

    /*
    this.client.on('reconnect', function () {
        console.log('client reconnected')
    });

    this.client.on('close', function () {
        console.log('client disconnected')
    });
    */

    this.client.on('offline', function () {
        self.emit('error');
    });

    this.client.on('error', function (error) {
        self.emit('error');
    });
}

/**
 * Handles receipt of a message from the MQTT broker. Finds the subscription that
 * the message corresponds to and executes the appropriate action.
 */
MQTTRegistry.prototype._handleMessage = function(self, topic, message) {
    // parse the mach type, the mach id, and the attribute out of the topic
    var components = topic.split('/');
    var machType = components[1];
    var machId = components[2];
    var attr = components[3];

    var eventName;
    if (attr === 'status') {
        if (message === 'offline') {
            eventName = self.attributesToDiscover[machType].status.offline;
        } else {
            eventName = self.attributesToDiscover[machType].status.online;
        }
    } else {
        eventName = self.attributesToDiscover[machType][attr];
    }

    self.emit('discovery', attr, eventName, machId, message);
}

/**
 * Helper for setting up subscriptions to the broker with retries
 */
MQTTRegistry.prototype._subscribeWithRetries = function(self, dattrs, retries) {
    var subs = [];

    for (var attr in dattrs.device) {
        subs[self.app + '/device/' + self.id + '/' + attr] = self.subQos;
    }

    for (var attr in dattrs.fog) {
        subs[self.app + '/fog/' + self.id + '/' + attr] = self.subQos;
    }

    for (var attr in dattrs.cloud) {
        subs[self.app + '/cloud/' + self.id + '/' + attr] = self.subQos;
    }

    if (subs.length === 0) {
        return;
    }

    self.client.subscribe(subs, function (err, granted) {
        if (err) {
            if (retries !== 0) {
                setTimeout(self._subscribeWithRetries, constants.mqtt.retryInterval, self, dattrs, retries - 1);
            }
        } else {
            // move attrs from attrsToSubTo to subscribedAttrs
            var components, machType, attr;
            for (var i = 0; i < granted.length; i++) {
                components = granted[i].topic.split('/');
                machType = components[1];
                attr = components[3];
                self.subscribedAttrs[machType][attr] = dattrs[machType][attr];
                delete self.attrsToSubTo[machType][attr];
            }
        }
    });
}

/**
 * Unsubscribe from a series of topics
 */
MQTTRegistry.prototype._unsubscribeWithRetries = function(self, dattrs, retries) {
    var topics = [];
    for (var attr in dattrs.device) {
        topics.push(self.app + '/device/+/' + dattrs.device[attr]);
    }

    for (var attr in dattrs.fog) {
        topics.push(self.app + '/fog/+/' + dattrs.fog[attr]);
    }

    for (var attr in dattrs.cloud) {
        topics.push(self.app + '/cloud/+/' + dattrs.cloud[attr]);
    }

    self.client.unsubscribe(topics, function(err) {
        if (err) {
            if (retries > 0) {
                setTimeout(self._unsubscribeWithRetries, constants.mqtt.retryInterval, self, topics, retries - 1);
            }
        } else {
            for (var attr in dattrs.device) {
                delete self.subscribedAttrs.device[attr];
                delete self.attrsToUnsubFrom.device[attr];
            }
            for (var attr in dattrs.fog) {
                delete self.subscribedAttrs.fog[attr];
                delete self.attrsToUnsubFrom.fog[attr];
            }
            for (var attr in dattrs.cloud) {
                delete self.subscribedAttrs.cloud[attr];
                delete self.attrsToUnsubFrom.cloud[attr];
            }
        }
    });
}

/**
 * Helper for publishing an attribute with retries
 */
MQTTRegistry.prototype._publishWithRetries = function(self, attr, value, retries) {
    var msg;
    if (value instanceof Function) {
        msg = JSON.stringify({ payload: value() });
    } else {
        msg = JSON.stringify({ payload: value });
    }
    self.client.publish(self.app + '/' + self.machType + '/' + self.id + '/' + attr, msg, {qos: self.pubQos, retain: true}, function (err) {
        if (err) {
            if (retries === 0) {
                setTimeout(self._publishWithRetries, constants.mqtt.retryInterval, self, attr, value, retries - 1);
            }
        } else {
            // move the attribute from attrsToPublish to publishedAttrs
            self.publishedAttrs[attr] = value;
            delete self.attrsToPublish[attr];
        }
    });
}

/**
 * Helper for "un"-publishing an attribute
 */
MQTTRegistry.prototype._unpublishWithRetries = function(self, attr, retries) {
    self.client.publish(self.app + '/' + self.machType + '/' + self.id + '/' + attr, null, {qos: self.pubQos, retain: true}, function (err) {
        if (err) {
            if (retries > 0) {
                setTimeout(self._unpublishWithRetries, constants.mqtt.retryInterval, self, attr, retries - 1);
            }
        } else {
            // remove the attribute from attrsToRemove and publishedAttrs
            delete self.attrsToRemove[attr];
            delete self.publishedAttrs[attr];
        }
    });
}

/**
 * Returns connection options to the mqtt broker contingent upon the connecting node
 * takes as arguments the name of the application, the type of the machine, and the
 * id of the machine
 */
MQTTRegistry.prototype._getConnectionOptions = function() {
    // create the will
    var will = {
        topic: this.app + '/' + this.machType + '/' + this.id + '/status',
        payload: JSON.stringify({ payload: 'offline' }),
        qos: this.pubQos,
        retain: true
    }

    // set and return the connection options
    return {
        clientId: this.id,
        keepalive: constants.mqtt.keepAlive,
        clean: false,
        connectTimeout: constants.mqtt.connectionTimeout,
        will: will
    };
}

//==============================================================================
// Custom attribute publication/discovery
//==============================================================================

/**
 * Add and publish discoverable attributes for this node
 */
MQTTRegistry.prototype.addAttributes = function(attrs) {
    for (var attr in attrs) {
        // just in case this is in the queue for removal...
        delete this.attrsToRemove[attr];
        // check that it's not already published
        if (!this.publishedAttrs.hasOwnProperty(attr)) {
            this.attrsToPublish[attr] = attrs[attr];
            if (this.client && this.client.connected) {
                // try to publish the attribute
                this._publishWithRetries(this, attr, attrs[attr], constants.mqtt.retries);
            }
        }
    }
}

MQTTRegistry.prototype.removeAttributes = function(attrs) {
    for (var i = 0; i < attrs.length; i++) {
        // remove it from attrsToPublish, if need be
        delete this.attrsToPublish[attrs[i]];
        if (this.publishedAttrs.hasOwnProperty(attrs[i])) {
            this.attrsToRemove[attrs[i]] = null;
            if (this.client && this.client.connected) {
                // try to remove it
                this._unpublishWithRetries(this, attrs[i], constants.mqtt.retries);
            }
        }
    }
}

MQTTRegistry.prototype.discoverAttributes = function(dattrs) {
    var subs = null;

    for (var attr in dattrs.device) {
        // in case this attr is queued up to be unsubscribed from
        delete this.attrsToUnsubFrom.device[attr];
        if (!this.subscribedAttrs.device.hasOwnProperty(attr)) {
            // try to subscribe to it
            if (subs === null) {
                subs = {
                    device: {},
                    fog: {},
                    cloud: {}
                };
            }
            subs.device[attr] = dattrs.device[attr];
            this.attrsToSubTo.device[attr] = dattrs.device[attr];
        }
    }

    for (var attr in dattrs.fog) {
        // in case this attr is queued up to be unsubscribed from
        delete this.attrsToUnsubFrom.fog[attr];
        if (!this.subscribedAttrs.fog.hasOwnProperty(attr)) {
            // try to subscribe to it
            if (subs === null) {
                subs = {
                    device: {},
                    fog: {},
                    cloud: {}
                };
            }
            subs.fog[attr] = dattrs.fog[attr];
            this.attrsToSubTo.fog[attr] = dattrs.fog[attr];
        }
    }

    for (var attr in dattrs.cloud) {
        // in case this attr is queued up to be unsubscribed from
        delete this.attrsToUnsubFrom.cloud[attr];
        if (!this.subscribedAttrs.cloud.hasOwnProperty(attr)) {
            // try to subscribe to it
            if (subs === null) {
                subs = {
                    device: {},
                    fog: {},
                    cloud: {}
                };
            }
            subs.cloud[attr] = dattrs.cloud[attr];
            this.attrsToSubTo.cloud[attr] = dattrs.cloud[attr];
        }
    }

    if (subs !== null && this.client && this.client.connected) {
        this._subscribeWithRetries(this, subs, constants.mqtt.retries);
    }
}

MQTTRegistry.prototype.stopDiscoveringAttributes = function(dattrs) {
    var unsubs = null;

    for (var i = 0; i < dattrs.device.length; i++) {
        delete this.attrsToSubTo[dattrs.device[i]];
        if (this.subscribedAttrs.hasOwnProperty(dattrs.device[i])) {
            this.attrsToUnsubFrom.device[dattrs.device[i]] = null;
            if (unsubs === null) {
                unsubs = {
                    device: {},
                    fog: {},
                    cloud: {}
                }
            }
            unsubs.device[dattrs.device[i]] = null;
        }
    }

    for (var i = 0; i < dattrs.fog.length; i++) {
        delete this.attrsToSubTo[dattrs.fog[i]];
        if (this.subscribedAttrs.hasOwnProperty(dattrs.fog[i])) {
            this.attrsToUnsubFrom.fog[dattrs.fog[i]] = null;
            if (unsubs === null) {
                unsubs = {
                    device: {},
                    fog: {},
                    cloud: {}
                }
            }
            unsubs.fog[dattrs.fog[i]] = null;
        }
    }

    for (var i = 0; i < dattrs.cloud.length; i++) {
        delete this.attrsToSubTo[dattrs.cloud[i]];
        if (this.subscribedAttrs.hasOwnProperty(dattrs.cloud[i])) {
            this.attrsToUnsubFrom.cloud[dattrs.cloud[i]] = null;
            if (unsubs === null) {
                unsubs = {
                    device: {},
                    fog: {},
                    cloud: {}
                }
            }
            unsubs.cloud[dattrs.cloud[i]] = null;
        }
    }

    if (unsubs !== null && this.client && this.client.connected) {
        this._unsubscribeWithRetries(this, unsubs, constants.mqtt.retries);
    }
}

/**
 * Closes the client, executing the callback upon completion
 */
MQTTRegistry.prototype.quit = function(cb) {
    if (this.client) {
        this.client.end(false, cb);
    }
}

/* exports */
module.exports = MQTTRegistry;
