import { useEffect, useMemo, useState } from 'react';
import { connect, disconnect, getLocalStorage, isConnected, request } from '@stacks/connect';
import {
  Cl,
  cvToValue,
  fetchCallReadOnlyFunction,
  noneCV,
  principalCV,
  uintCV
} from '@stacks/transactions';

const appDetails = {
  name: 'FROG Faucet'
};

const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS || '';
const contractName = import.meta.env.VITE_CONTRACT_NAME || 'frog-token';
const network = 'testnet';

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
  if (typeof value === 'object' && 'value' in value) {
    return stringifyClarityValue(value.value);
  }
  return JSON.stringify(value);
};

export default function App() {
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState('');
  const [nextClaimBlock, setNextClaimBlock] = useState('');
  const [canClaim, setCanClaim] = useState(true);
  const [status, setStatus] = useState('');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');

  const ready = useMemo(() => contractAddress.length > 0, [contractAddress]);

  const loadAddress = () => {
    const data = getLocalStorage();
    const stxAddress = data?.addresses?.stx?.[0]?.address || '';
    if (stxAddress) setAddress(stxAddress);
    return stxAddress;
  };

  const connectWallet = async () => {
    setStatus('Đang kết nối ví...');
    try {
      const response = await connect({ appDetails });
      // Prefer response payload, fallback to local storage
      const stxFromResponse =
        response?.addresses?.stx?.[0]?.address ||
        response?.addresses?.find?.((item) => item?.address?.startsWith?.('S'))?.address ||
        '';
      const stxAddress = stxFromResponse || loadAddress();
      if (!stxAddress) {
        setStatus('Không lấy được địa chỉ ví.');
        return;
      }
      setAddress(stxAddress);
      setStatus('Đã kết nối ví.');
      await refreshData();
    } catch (err) {
      setStatus(`Kết nối thất bại: ${err?.message || err}`);
    }
  };

  const disconnectWallet = () => {
    disconnect();
    setAddress('');
    setBalance('');
    setNextClaimBlock('');
    setStatus('Đã ngắt kết nối.');
  };

  const readOnly = async (functionName, functionArgs = []) => {
    const senderAddress = address || contractAddress;
    const result = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName,
      functionArgs,
      senderAddress,
      network
    });
    return unwrapResponse(result);
  };

  const refreshData = async () => {
    if (!address || !ready) return;
    try {
      const bal = await readOnly('get-balance', [principalCV(address)]);
      const next = await readOnly('get-next-claim-block', [principalCV(address)]);
      const can = await readOnly('can-claim?', [principalCV(address)]);
      setBalance(stringifyClarityValue(bal));
      setNextClaimBlock(stringifyClarityValue(next));
      setCanClaim(Boolean(can));
    } catch (err) {
      setStatus(`Đọc dữ liệu lỗi: ${err?.message || err}`);
    }
  };

  const claim = async () => {
    if (!canClaim) {
      setStatus('Chưa đủ 24h cooldown. Vui lòng thử lại sau.');
      return;
    }
    setStatus('Đang claim...');
    try {
      await request('stx_callContract', {
        contract: `${contractAddress}.${contractName}`,
        functionName: 'claim',
        functionArgs: [],
        network
      });
      setStatus('Đã gửi giao dịch claim.');
    } catch (err) {
      setStatus(`Claim thất bại: ${err?.message || err}`);
    }
  };

  const transfer = async () => {
    if (!recipient || !amount) return;
    setStatus('Đang chuyển token...');
    try {
      await request('stx_callContract', {
        contract: `${contractAddress}.${contractName}`,
        functionName: 'transfer',
        functionArgs: [
          Cl.uint(BigInt(amount)),
          Cl.standardPrincipal(address),
          Cl.standardPrincipal(recipient),
          Cl.none()
        ],
        network
      });
      setStatus('Đã gửi giao dịch chuyển token.');
    } catch (err) {
      setStatus(`Chuyển token thất bại: ${err?.message || err}`);
    }
  };

  useEffect(() => {
    if (isConnected()) {
      loadAddress();
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [address]);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">FROG FT + Faucet</p>
          <h1>Faucet 24h cho token FROG</h1>
          <p className="subtext">
            Claim 1,000 FROG mỗi 24h. Kết nối ví, nhận token, và thử chuyển cho bạn bè.
          </p>
        </div>
        <div className="panel">
          <div className="row">
            <span>Trạng thái</span>
            <strong>{address ? 'Đã kết nối' : 'Chưa kết nối'}</strong>
          </div>
          <div className="row">
            <span>Ví</span>
            <strong className="mono">{address || '—'}</strong>
          </div>
          <div className="row">
            <span>Balance</span>
            <strong>{balance || '—'} FROG</strong>
          </div>
          <div className="row">
            <span>Next claim (block)</span>
            <strong>{nextClaimBlock || '—'}</strong>
          </div>
          <div className="actions">
            {!address ? (
              <button onClick={connectWallet} disabled={!ready}>Kết nối ví</button>
            ) : (
              <>
                <button onClick={claim} disabled={!canClaim}>
                  {canClaim ? 'Claim 1,000 FROG' : 'Chưa đủ 24h'}
                </button>
                <button className="ghost" onClick={disconnectWallet}>Ngắt kết nối</button>
              </>
            )}
          </div>
          {status && <p className="status">{status}</p>}
          {!canClaim && (
            <p className="status">Faucet giới hạn 24h. Đợi đến block {nextClaimBlock} để claim lại.</p>
          )}
        </div>
      </header>

      <section className="grid">
        <div className="card">
          <h2>Transfer</h2>
          <label>
            Ví nhận
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="SP..."
            />
          </label>
          <label>
            Số lượng
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100"
            />
          </label>
          <button onClick={transfer} disabled={!address || !recipient || !amount}>
            Gửi
          </button>
        </div>

        <div className="card">
          <h2>Thông tin hợp đồng</h2>
          <ul>
            <li><span>Contract</span> <strong className="mono">{contractAddress}.{contractName}</strong></li>
            <li><span>Network</span> <strong>{network}</strong></li>
            <li><span>Decimals</span> <strong>0</strong></li>
            <li><span>Cooldown</span> <strong>24h (~144 blocks)</strong></li>
          </ul>
        </div>
      </section>
    </div>
  );
}
