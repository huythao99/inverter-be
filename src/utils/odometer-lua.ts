/**
 * Redis Lua script of OdometerAccumulatorService: one STM32 odometer reading
 * (kWh, both counters) -> energy increase of the day. Runs atomically.
 *
 * KEYS[1] state hash of the device (no day):
 *           lastA/lastA2  last accepted reading (the baseline)
 *           candA/candA2  first reading of a drop not confirmed yet
 *           nA/nA2        how many consecutive readings confirmed it
 * KEYS[2] day hash: eA/eA2 energy of the day, lastA/lastA2 latest reading,
 *         maxA/maxA2, minA/minA2, gap (1 = the day's energy misses a part)
 * KEYS[3] set of day hashes to flush to MongoDB
 *
 * ARGV: 1 a, 2 a2, 3 member of KEYS[3], 4 readings needed to confirm a drop,
 *       5 tolerance (kWh), 6 day hash TTL (s), 7 state TTL (s),
 *       8 seed flag ("1" = seed args below are set; "0" = none),
 *       9 seed lastA, 10 seed lastA2 ("" = no baseline: start from this reading),
 *       11 seed eA, 12 seed eA2 ("" = none), 13 seed gap ("1"/"0")
 *
 * Per counter:
 *   reading >= baseline - tolerance : add (reading - baseline) if > 0,
 *                                     baseline = max(baseline, reading)
 *   reading below it                : candidate. Confirmed when `need`
 *                                     readings in a row stay at/above it
 *                                     (a single corrupted frame never is):
 *                                     baseline = reading, add (reading -
 *                                     candidate) = energy since the drop.
 *
 * Returns "seed" when the device has no state and no seed was passed (the
 * caller loads the seed from MongoDB and calls again), else "ok".
 */
export const ODOMETER_STEP_LUA = `
local st = KEYS[1]
local dk = KEYS[2]
local cur = { tonumber(ARGV[1]), tonumber(ARGV[2]) }
local need = tonumber(ARGV[4])
local eps = tonumber(ARGV[5])
local names = { 'A', 'A2' }

if redis.call('HEXISTS', st, 'lastA') == 0 then
  if ARGV[8] ~= '1' then return 'seed' end
  local sa = tonumber(ARGV[9])
  local sa2 = tonumber(ARGV[10])
  redis.call('HSET', st, 'lastA', sa or cur[1], 'lastA2', sa2 or cur[2])
  if redis.call('HEXISTS', dk, 'eA') == 0 then
    local ea = tonumber(ARGV[11])
    local ea2 = tonumber(ARGV[12])
    if ea and ea2 then
      redis.call('HSET', dk, 'eA', ea, 'eA2', ea2)
    end
  end
  if ARGV[13] == '1' then redis.call('HSET', dk, 'gap', 1) end
end

local add = { 0, 0 }
for i = 1, 2 do
  local nm = names[i]
  local c = cur[i]
  local last = tonumber(redis.call('HGET', st, 'last' .. nm))
  if last == nil then
    -- damaged state (one counter missing): restart from this reading
    redis.call('HSET', st, 'last' .. nm, c)
    last = c
  end
  if c >= last - eps then
    if c > last then
      add[i] = c - last
      redis.call('HSET', st, 'last' .. nm, c)
    end
    redis.call('HDEL', st, 'cand' .. nm, 'n' .. nm)
  else
    local cand = tonumber(redis.call('HGET', st, 'cand' .. nm))
    local n = tonumber(redis.call('HGET', st, 'n' .. nm)) or 0
    if cand ~= nil and c >= cand - eps then
      n = n + 1
    else
      cand = c
      n = 1
    end
    if n >= need then
      if c > cand then add[i] = c - cand end
      redis.call('HSET', st, 'last' .. nm, c)
      redis.call('HDEL', st, 'cand' .. nm, 'n' .. nm)
    else
      redis.call('HSET', st, 'cand' .. nm, cand, 'n' .. nm, n)
    end
  end
end

redis.call('HINCRBYFLOAT', dk, 'eA', add[1])
redis.call('HINCRBYFLOAT', dk, 'eA2', add[2])
redis.call('HSET', dk, 'lastA', cur[1], 'lastA2', cur[2])
for i = 1, 2 do
  local nm = names[i]
  local mx = tonumber(redis.call('HGET', dk, 'max' .. nm))
  if mx == nil or cur[i] > mx then redis.call('HSET', dk, 'max' .. nm, cur[i]) end
  local mn = tonumber(redis.call('HGET', dk, 'min' .. nm))
  if mn == nil or cur[i] < mn then redis.call('HSET', dk, 'min' .. nm, cur[i]) end
end
redis.call('EXPIRE', dk, tonumber(ARGV[6]))
redis.call('EXPIRE', st, tonumber(ARGV[7]))
redis.call('SADD', KEYS[3], ARGV[3])
return 'ok'
`;
