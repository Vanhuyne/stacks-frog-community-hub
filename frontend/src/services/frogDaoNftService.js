import { request } from '@stacks/connect';
import { Cl, cvToValue, fetchCallReadOnlyFunction, principalCV } from '@stacks/transactions';

const unwrapResponse = (cv) => {
  const value = cvToValue(cv);
  if (value && typeof value === 'object' && 'type' in value) {
    if (value.type === 'ok') return value.value;
    if (value.type === 'err') throw new Error(`Contract error: ${value.value}`);
  }
  return value;
};

const unwrapOptional = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value && value.type === 'some') return value.value;
  if (typeof value === 'object' && value && value.type === 'none') return null;
  return value;
};

const getTupleField = (tuple, keys) => {
  if (!tuple) return undefined;
  if (typeof tuple !== 'object') return undefined;

  for (const key of keys) {
    if (key in tuple) return tuple[key];
  }

  const tupleKeys = Object.keys(tuple);
  if (tupleKeys.length === 1) return tuple[tupleKeys[0]];
  return undefined;
};

const stringifyClarityValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object' && 'value' in value) return stringifyClarityValue(value.value);
  return JSON.stringify(value);
};

export const createFrogDaoNftService = ({ contractAddress, contractName, network, readOnlyBaseUrl }) => {
  const readOnly = async (senderAddress, functionName, functionArgs = []) => {
    const client = readOnlyBaseUrl ? { baseUrl: readOnlyBaseUrl } : undefined;

    const result = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName,
      functionArgs,
      senderAddress,
      network,
      client
    });
    return unwrapResponse(result);
  };

  const fetchDaoSnapshot = async (address) => {
    const frogBalanceRaw = await readOnly(address, 'get-frog-balance', [principalCV(address)]);
    const usernameRaw = await readOnly(address, 'get-username', [principalCV(address)]);
    const passRaw = await readOnly(address, 'get-pass-id', [principalCV(address)]);
    const eligibleRaw = await readOnly(address, 'is-eligible-to-mint?', [principalCV(address)]);

    const usernameTuple = unwrapOptional(usernameRaw);
    const passTuple = unwrapOptional(passRaw);

    const usernameField = getTupleField(usernameTuple, ['name', 'username']);
    const passIdField = getTupleField(passTuple, ['token-id', 'token_id', 'tokenId']);

    const username = stringifyClarityValue(usernameField);
    const passId = passIdField;

    return {
      frogBalance: stringifyClarityValue(frogBalanceRaw),
      username,
      hasPass: Boolean(passTuple),
      passId: stringifyClarityValue(passId),
      eligible: Boolean(eligibleRaw)
    };
  };

  const registerUsername = async (name) => {
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'register-username',
      functionArgs: [Cl.stringAscii(name)],
      network
    });
  };

  const mintPass = async () => {
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'mint-pass',
      functionArgs: [],
      network
    });
  };

  return {
    fetchDaoSnapshot,
    registerUsername,
    mintPass
  };
};
