

1. 'Fog down when upgrading protocol'
Status: Fixed
To reproduce:
- start a device and fog, both using mDNS (no mosquitto broker up)
- then start a mosquitto broker
- when the fog switches over to mqtt, the device will get a 'fog-down' event
The likely culprit: the device has already switched over to mqtt and is listening on the mdns local channel for fogs. When the fog realizes it can switch to MQTT, it shuts down its advertisement on the mDNS local channel, which the device sees.
Something strange: even though the fog shuts down its advertisement, it is then immediately coming online on MQTT, and so the device should see it as online on MQTT, and thus determine that it is indeed online.
The reason: The mqtt-fog-up event fires before the mdns-fog-down event, and thus when the mqtt-fog-up event is received, it is ignored, because we already have the fog recorded as online.

Proposed fix: We need to NOT fire events during the 'reset' actions of a node before we attempt to upgrade protocols. See \_reset function (line 270) of jregistrar and find a way to ensure that the functions called within this method do not trigger events.
