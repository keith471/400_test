

module.exports = {

    globals: {
        NodeType: Object.freeze({
            DEVICE: 'device',
            FOG: 'fog',
            CLOUD: 'cloud'
        }),
        localhost: '127.0.0.1',
        protocols: Object.freeze({
            MQTT: 'mqtt',
            MDNS: 'mdns',
            LOCALSTORAGE: 'localStorage'
        }),
        channels: Object.freeze({
            DEFAULT: 0,
            LOCAL: 1
        })
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
        ipCheckInterval: 120000 // 2 minutes (unlikely for IP on LAN to change)
    },

    localStorage: {
        checkInInterval: 3000, // 3 seconds
        scanInterval: 3000, // 3 seconds
        queryRetries: 10,
        initLock: 'init.lock',
        stale: 1000, // 1 second
        numBins: 10 // number of fog and cloud bins to use
    }
}
