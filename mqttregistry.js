//==============================================================================
// Registers a node on the network using MQTT
//==============================================================================

var mqtt = require('mqtt'),
    logger = require('./jerrlog.js'),
    constants = require('./constants'),
    Registry = require('./registry');

function MQTTRegistry(app, machType, id, port, subQos, pubQos) {
    this.app = app;
    this.machType = machType;
    this.id = id;
    this.port = port;
    // the quality of service to use for subscriptions
    this.subQos = subQos;
    // the quality of service to use for publications
    this.pubQos = pubQos;
    // attributes to remove the next time we connect
    this.attrsToRemove = {};
    // topics to unsubscribe from the next time we connect
    this.topicsToUnsubscribeFrom = [];
}

/* MQTTRegistry inherits from Registry */
MQTTRegistry.prototype = new Registry();

/**
 * Performs basic registration and discovery
 * Designed to be called multiple times if need be
 */
MQTTRegistry.prototype.registerAndDiscover = function(options) {
    // collect old vs. new subscriptions and attributes
    var oldAttrs = {};
    var oldSubs = {};
    var newAttrs = null;
    var newSubs = null;

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


    for (var key in this.discoverAttributes.device) {
        oldSubs[this.app + '/device/+/' + key] = this.subQos;
    }

    for (var key in this.discoverAttributes.fog) {
        oldSubs[this.app + '/fog/+/' + key] = this.subQos;
    }

    for (var key in this.discoverAttributes.cloud) {
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

        // discoverAttributes
        for (var key in options.discoverAttributes.device) {
            // add to this.discoverAttributes
            this.discoverAttributes.device[key] = options.discoverAttributes.device[key];
            // add to newSubs
            if (newSubs === null) {
                newSubs = {};
            }
            newSubs[this.app + '/device/+/' + key] = this.subQos;
        }

        for (var key in options.discoverAttributes.fog) {
            this.discoverAttributes.fog[key] = options.discoverAttributes.fog[key];
            if (newSubs === null) {
                newSubs = {};
            }
            newSubs[this.app + '/fog/+/' + key] = this.subQos;
        }

        for (var key in options.discoverAttributes.cloud) {
            this.discoverAttributes.cloud[key] = options.discoverAttributes.cloud[key];
            if (newSubs === null) {
                newSubs = {};
            }
            newSubs[this.app + '/cloud/+/' + key] = this.subQos;
        }
    }

    // create an mqtt client
    this.client = mqtt.connect(constants.mqtt.brokerUrl, this._getConnectionOptions(this.app, this.machType, this.id));

    // set up event listeners for the client
    this._prepareForEvents(newSubs, oldSubs, newAttrs, oldAttrs);
}

/**
 * Publish a query for a node's port and ip address
 * Pass as a message the id of the node making the request, though this is not used at this point
 */
/*
MQTTRegistry.prototype.query = function(machType, machId) {
    this.client.publish(this.app + '/query/' + machType + '/' + machId + '/ipandport', this.id, {qos: 1, retain: false}, function (err) {
        if (err) {
            logger.log.error(err);
        }
    });
}
*/

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
            self._handleMessage(self, topic, parsedMsg);
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
        logger.log.error(error);
        self.emit('error');
    });
}

/**
 * Helper for setting up subscriptions to the broker with retries
 */
MQTTRegistry.prototype._subscribeWithRetries = function(self, subs, retries, cb) {
    self.client.subscribe(subs, function (err, granted) {
        if (err) {
            logger.log.error(err);
            if (retries === 0) {
                // an error here means the node has been unable to subscribe and will therefore
                // be unresponsive to requests from other nodes. thus, it should NOT publish
                // its presence on the network
                self.emit('error');
            } else {
                setTimeout(self._subscribeWithRetries, constants.mqtt.retryInterval, self, subs, retries - 1, cb);
            }
        } else {
            if (cb !== undefined) {
                cb(granted);
            }
        }
    });
}

/**
 * Unsubscribe from a series of topics
 */
MQTTRegistry.prototype._unsubscribe = function(self, topics, cb) {
    self.client.unsubscribe(topics, function(err) {
        if (cb) {
            cb(err);
        }
    });
}

/**
 * Helper for publishing a node's presence on the network
 * TODO: could use async package to improve this
 */
MQTTRegistry.prototype._publishWithRetries = function(self, attrs, retries, cb) {
    var msg;
    var count = 0;
    var error = false;
    for (var key in attrs) {
        if (error) {
            break;
        }
        if (attrs[key] instanceof Function) {
            msg = JSON.stringify(attrs[key]());
        } else {
            msg = JSON.stringify(attrs[key]);
        }
        self.client.publish(self.app + '/' + self.machType + '/' + self.id + '/' + key, msg, {qos: self.pubQos, retain: true}, function (err) {
            if (error) {
                // there's already been an error - stop
                return;
            }
            if (err) {
                logger.log.error(err);
                if (retries === 0) {
                    error = true;
                    // TODO: do we really need to emit an error if one publication is not successful? What if it is not an important publication
                    self.emit('error');
                    if (cb) {
                        cb(err);
                    }
                } else {
                    setTimeout(self._publishWithRetries, constants.mqtt.retryInterval, self, attrs, retries - 1);
                }
            } else {
                count++;
                if (count == Object.keys(attrs).length && cb) {
                    cb();
                }
            }
        });
    }
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
            eventName = self.discoverAttributes[machType].status.offline;
        } else {
            eventName = self.discoverAttributes[machType].status.online;
        }
    } else {
        eventName = self.discoverAttributes[machType][attr];
    }

    self.emit('discovery', attr, eventName, machId, message);
}

/**
 * Returns connection options to the mqtt broker contingent upon the connecting node
 * takes as arguments the name of the application, the type of the machine, and the
 * id of the machine
 */
MQTTRegistry.prototype._getConnectionOptions = function(appName, machType, machId) {
    // create the will
    var will;

    if (machType === constants.globals.NodeType.DEVICE) {
        will = {
            topic: appName + '/device/' + machId + '/status',
            payload: 'offline',
            qos: 0,
            retain: true
        };
    } else if (machType === constants.globals.NodeType.FOG) {
        will = {
            topic: appName + '/fog/' + machId + '/status',
            payload: 'offline',
            qos: 1,
            retain: true
        };
    } else {
        will = {
            topic: appName + '/cloud/' + machId + '/status',
            payload: 'offline',
            qos: 1,
            retain: true
        };
    }

    // set and return the connection options
    return {
        clientId: machId,
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
    // store the attrs on the node
    for (var key in attrs) {
        this.attributes[key] = attrs[key];
    }

    // if the client is currently connected to the broker, then publish the attrs
    // otherwise, we can simply wait and the attrs will be published next time the client
    // connects to the broker
    if (this.client && this.client.connected) {
        this._publishWithRetries(this, attrs, constants.mqtt.retries);
    }
}

MQTTRegistry.prototype.removeAttributes = function(attrs) {
    var publishableAttrs = {};
    for (var i = 0; i < attrs.length; i++) {
        delete this.attributes[attrs[i]];
        publishableAttrs[attrs[i]] = null;
    }

    if (this.client && this.client.connected) {
        this._publishWithRetries(this, publishableAttrs, constants.mqtt.retries);
    } else {
        // the attributes will be removed the next time we connect to the broker
        for (var i = 0; i < attrs.length; i++) {
            this.attrsToRemove[attr] = null;
        }
    }
}

// TODO: avoid sending repeat subscriptions
MQTTRegistry.prototype.discoverAttributes = function(attrs) {
    // store the attributes on the node
    var subs = {};
    var isEmpty = true;
    for (var key in attrs.device) {
        isEmpty = false;
        this.discoverAttributes.device[key] = attrs.device[key];
        subs[this.app + '/device/+/' + key] = this.subQos;
    }

    for (var key in attrs.fog) {
        isEmpty = false;
        this.discoverAttributes.fog[key] = attrs.fog[key];
        subs[this.app + '/fog/+/' + key] = this.subQos;
    }

    for (var key in attrs.cloud) {
        isEmpty = false;
        this.discoverAttributes.cloud[key] = attrs.cloud[key];
        subs[this.app + '/cloud/+/' + key] = this.subQos;
    }

    // if the client is currently connected to the broker, then subscribe to the attrs
    // otherwise, we can wait and we will subscribe to them next time the client connects to
    // the broker
    if (!isEmpty && this.client && this.client.connected) {
        this._subscribeWithRetries(this, subs, constants.mqtt.retries, function(granted) {
            logger.log(granted);
        });
    }
}

MQTTRegistry.prototype.stopDiscoveringAttributes = function(dattrs) {
    var topics = [];
    for (var i = 0; i < dattrs.device.length; i++) {
        delete this.discoverAttributes.device[dattrs.device[i]];
        topics.push(this.app + '/device/+/' + dattrs.device[i]);
    }

    for (var i = 0; i < dattrs.fog.length; i++) {
        delete this.discoverAttributes.fog[dattrs.fog[i]];
        topics.push(this.app + '/fog/+/' + dattrs.fog[i]);
    }

    for (var i = 0; i < dattrs.cloud.length; i++) {
        delete this.discoverAttributes.cloud[dattrs.cloud[i]];
        topics.push(this.app + '/cloud/+/' + dattrs.cloud[i]);
    }

    if (this.client && this.client.connected) {
        this._unsubscribe(this, topics, function(err) {
            if (!err) {
                // reset topicsToUnsubscribeFrom
                this.topicsToUnsubscribeFrom = [];
            }
        });
    } else {
        this.topicsToUnsubscribeFrom = this.topicsToUnsubscribeFrom.concat(topics);
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
