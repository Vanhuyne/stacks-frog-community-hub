import { connect, disconnect, getLocalStorage, request } from '@stacks/connect';
import { Cl, cvToValue, fetchCallReadOnlyFunction, principalCV } from '@stacks/transactions';

const unwrapResponse = (cv) => {
  const value = cvToValue(cv);
  if (value && typeof value === 'object' && 'type' in value) {
    if (value.type === 'ok') return value.value;
    if (value.type === 'err') throw new Error(`Contract error: ${value.value}`);
  }
  return value;
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

export const createFrogContractService = ({ contractAddress, contractName, network, readOnlyNetwork }) => {
  const getStoredAddress = () => {
    const data = getLocalStorage();
    return data?.addresses?.stx?.[0]?.address || '';
  };

  const connectWallet = async (appDetails) => {
    const response = await connect({ appDetails });
    return (
      response?.addresses?.stx?.[0]?.address ||
      response?.addresses?.find?.((item) => item?.address?.startsWith?.('S'))?.address ||
      getStoredAddress()
    );
  };

  const readOnly = async (senderAddress, functionName, functionArgs = []) => {
    const result = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName,
      functionArgs,
      senderAddress,
      network: readOnlyNetwork || network
    });
    return unwrapResponse(result);
  };

  const fetchFaucetSnapshot = async (address) => {
    const bal = await readOnly(address, 'get-balance', [principalCV(address)]);
    const next = await readOnly(address, 'get-next-claim-block', [principalCV(address)]);
    const can = await readOnly(address, 'can-claim?', [principalCV(address)]);

    return {
      balance: stringifyClarityValue(bal),
      nextClaimBlock: stringifyClarityValue(next),
      canClaim: Boolean(can)
    };
  };

  const claim = async () => {
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'claim',
      functionArgs: [],
      network: readOnlyNetwork || network
    });
  };

  const transfer = async ({ amount, sender, recipient }) => {
    await request('stx_callContract', {
      contract: `${contractAddress}.${contractName}`,
      functionName: 'transfer',
      functionArgs: [
        Cl.uint(BigInt(amount)),
        Cl.standardPrincipal(sender),
        Cl.standardPrincipal(recipient),
        Cl.none()
      ],
      network: readOnlyNetwork || network
    });
  };

  return {
    connectWallet,
    disconnectWallet: disconnect,
    getStoredAddress,
    fetchFaucetSnapshot,
    claim,
    transfer
  };
};
