'use strict';
const { readConfig, requiredScope, createM2MAuth } = require('./m2m');

const CONFIG = {userPoolId:'us-east-1_ABC123',clientIds:['service-123'],readScope:'encounters/read',writeScope:'encounters/write'};
const TOKEN = 'eyJ.eyJ.abc';
const claims = (extra={}) => ({token_use:'access',client_id:'service-123',scope:'encounters/read encounters/write',...extra});
function req(method='GET',path='/encounters',authorization=`Bearer ${TOKEN}`) {
  return { method,path,get: n => n === 'authorization' ? authorization : undefined };
}
function response() {
  return {headers:{},code:200,set(k,v){this.headers[k]=v;return this;},status(n){this.code=n;return this;},json(obj){this.body=obj;return this;}};
}
async function run(token=claims(),request=req()) {
  const res=response(),next=jest.fn();
  const verifyToken=jest.fn().mockResolvedValue(token);
  await createM2MAuth({config:CONFIG,verifyToken})(request,res,next);
  return {res,next,verifyToken,request};
}

test('configuration fails closed without pool, client, or scopes', () => {
  const base={AUTH_COGNITO_USER_POOL_ID:'us-east-1_ABC123',AUTH_M2M_CLIENT_IDS:'svc',AUTH_READ_SCOPE:'encounters/read',AUTH_WRITE_SCOPE:'encounters/write'};
  expect(()=>readConfig(base)).not.toThrow();
  for(const key of Object.keys(base)) expect(()=>readConfig({...base,[key]:''})).toThrow();
  expect(()=>readConfig({...base,AUTH_M2M_CLIENT_IDS:'svc,svc'})).toThrow();
  expect(()=>readConfig({...base,AUTH_WRITE_SCOPE:'encounters/read'})).toThrow();
});

test.each(['GET','HEAD','POST','PATCH','PUT','DELETE'])("%s requires expected permission", async method => {
  const result=await run(claims(),req(method));
  expect(result.next).toHaveBeenCalledTimes(1);
  expect(result.request.auth).toEqual({type:'service',clientId:'service-123'});
});

test('GET /api/id is write scope (not read)', async () => {
  for (const method of ['GET','HEAD']) {
    for (const path of ['/id','/id/','/ID']) {
      expect(requiredScope(req(method,path),CONFIG)).toBe('encounters/write');
    }
  }
  const x=await run(claims({scope:'encounters/read'}),req('GET','/id'));
  expect(x.res.code).toBe(403);
});

test('missing and malformed tokens never reach the verifier', async () => {
  for(const value of ['', 'Basic x', 'Bearer abc', 'Bearer eyJ.eyJ.abc extra']) {
    const x=await run(claims(),req('GET','/encounters',value));
    expect(x.res.code).toBe(401);expect(x.next).not.toHaveBeenCalled();expect(x.verifyToken).not.toHaveBeenCalled();
  }
});

test('invalid signature/expired token rejected by verifier', async () => {
  const res=response(),next=jest.fn();
  await createM2MAuth({config:CONFIG,verifyToken:()=>Promise.reject(new Error('expired'))})(req(),res,next);
  expect(res.code).toBe(401);expect(next).not.toHaveBeenCalled();
});

test.each([
  {token_use:'id'}, {client_id:'other'}, {client_id:undefined},
  {username:'user'}, {'cognito:groups':['admins']}, {'cognito:username':'alice'}
])('rejects non-service token %p', async override => {
  const x=await run(claims(override));expect(x.res.code).toBe(401);expect(x.next).not.toHaveBeenCalled();
});

test('read scope cannot mutate', async () => {
  const x=await run(claims({scope:'encounters/read'}),req('POST'));
  expect(x.res.code).toBe(403);expect(x.next).not.toHaveBeenCalled();
});

test('write scope does not automatically imply read', async () => {
  const x=await run(claims({scope:'encounters/write'}),req('GET'));
  expect(x.res.code).toBe(403);expect(x.next).not.toHaveBeenCalled();
});

test('scope matching is exact, not substring-based', async () => {
  const x=await run(claims({scope:'encounters/read-all encounters/write-all'}));
  expect(x.res.code).toBe(403);
});

test('unsupported methods do not reach verifier', async () => {
  const x=await run(claims(),req('TRACE'));
  expect(x.res.code).toBe(405);expect(x.next).not.toHaveBeenCalled();
});
