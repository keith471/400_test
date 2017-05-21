

module.exports = Object.freeze.({

    globals: {
        NodeType: {
            DEVICE: 'device',
            FOG: 'fog',
            CLOUD: 'cloud'
        },
        Status: {
            ONLINE: 'online',
            OFFLINE: 'offline'
        },
        localhost: '127.0.0.1',
        Protocol: {
            MQTT: 'mqtt',
            MDNS: 'mdns',
            LOCALSTORAGE: 'localStorage'
        },
        Channel: {
            DEFAULT: 0,
            LOCAL: 1
        },
        Context: {
            REGISTRATION: 'regular old registration',
            REGISTRATION_SETUP: 'registration setup',
            PROTOCOL_UPGRADE: 'protocol upgrade'
        },
        upgradeInterval: 600000 // 10 minutes
    },

    mqtt: {
        keepAlive: 10, // 10 seconds
        connectionTimeout: 10000, // 10 seconds
        retries: 5,
        retryInterval: 2000, // 2 seconds
        brokerUrl: 'tcp://localhost:1883'
    },

    mdns: {
        retries: 5,
        retryInterval: 2000, // 2 seconds
        ipCheckInterval: 120000, // 2 minutes (unlikely for IP on LAN to change)
    },

    localStorage: {
        checkInInterval: 3000, // 3 seconds
        scanInterval: 3000, // 3 seconds
        queryRetries: 10,
        initLock: 'init.lock',
        stale: 1000, // 1 second
        numBins: 10, // number of fog and cloud bins to use
    }
});
