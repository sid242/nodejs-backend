import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeRedisClients } from '../src/config/redis';
import { isPrivateNetworkHostname } from '../src/lib/cors';

after(async () => {
  await closeRedisClients();
});

test('isPrivateNetworkHostname correctly identifies private LAN and loopback hostnames', () => {
  // Loopback
  assert.equal(isPrivateNetworkHostname('localhost'), true);
  assert.equal(isPrivateNetworkHostname('127.0.0.1'), true);
  assert.equal(isPrivateNetworkHostname('::1'), true);

  // 192.168.x.x
  assert.equal(isPrivateNetworkHostname('192.168.1.45'), true);
  assert.equal(isPrivateNetworkHostname('192.168.0.1'), true);
  assert.equal(isPrivateNetworkHostname('192.168.254.254'), true);

  // 10.x.x.x
  assert.equal(isPrivateNetworkHostname('10.0.0.1'), true);
  assert.equal(isPrivateNetworkHostname('10.100.50.25'), true);

  // 172.16-31.x.x
  assert.equal(isPrivateNetworkHostname('172.16.0.1'), true);
  assert.equal(isPrivateNetworkHostname('172.20.10.2'), true);
  assert.equal(isPrivateNetworkHostname('172.31.255.254'), true);

  // Public / external hostnames (must be false)
  assert.equal(isPrivateNetworkHostname('172.32.0.1'), false);
  assert.equal(isPrivateNetworkHostname('8.8.8.8'), false);
  assert.equal(isPrivateNetworkHostname('1.1.1.1'), false);
  assert.equal(isPrivateNetworkHostname('example.com'), false);
  assert.equal(isPrivateNetworkHostname('app.mycompany.com'), false);
  assert.equal(isPrivateNetworkHostname('google.com'), false);
});
