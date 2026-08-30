import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { friendlyContractError, useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';

function Register() {
  const transactionInFlight = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRole = searchParams.get('role') === 'carrier'
    ? '2'
    : searchParams.get('role') === 'arbitrator'
      ? '3'
      : '1';
  const {
    account,
    authorizedAccountCount,
    isConnected,
    isConnecting,
    connectWallet,
    switchWallet,
  } = useWallet();
  const {
    deploymentStatus,
    getWriteContract,
    isConfigured,
    isCorrectNetwork,
    switchToExpectedNetwork,
    waitForTransaction,
  } = useContract();
  const { isDesignatedArbitrator, isRegistered, profile, loading } = useProfile();
  const [name, setName] = useState('');
  const [role, setRole] = useState(requestedRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setRole(requestedRole === '3' && !isDesignatedArbitrator ? '1' : requestedRole);
  }, [isDesignatedArbitrator, requestedRole]);

  const chooseRole = (nextRole) => {
    setRole(nextRole);
    setSearchParams({
      role: nextRole === '1' ? 'shipper' : nextRole === '2' ? 'carrier' : 'arbitrator',
    });
    setError('');
  };

  const selectWalletForOtherRole = async () => {
    chooseRole(profile?.role === 1 ? '2' : '1');
    await switchWallet();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!isConnected) {
      setError('Connect MetaMask and confirm the wallet address before registering.');
      return;
    }
    if (!isCorrectNetwork) {
      setError('Switch MetaMask to Sepolia before registering.');
      return;
    }
    if (deploymentStatus !== 'ready') {
      setError('Deploy the Sepolia escrow contract before registering.');
      return;
    }
    if (transactionInFlight.current) return;
    transactionInFlight.current = true;
    try {
      setBusy(true);
      setError('');
      setSuccess('');
      const contract = await getWriteContract();
      await waitForTransaction(await contract.register(name.trim(), Number(role)));
      const roleLabel = role === '1' ? 'Shipper' : role === '2' ? 'Carrier' : 'Arbitrator';
      setSuccess(`Registration confirmed. This wallet is now an ${roleLabel}.`);
    } catch (registerError) {
      setError(friendlyContractError(registerError));
    } finally {
      transactionInFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="form-card auth-card setup-card">
        <Link className="brand dark" to="/">ChainCargo</Link>
        <span className="eyebrow">Step 1 of your account setup</span>
        <h2>Register a wallet role</h2>
        <p>Each MetaMask account has one permanent role in the Sepolia deployment.</p>

        <div className="wallet-preview">
          <small>Wallet being registered</small>
          <code>{account || 'Connect MetaMask to continue'}</code>
        </div>

        {loading && isConnected && <div className="notice">Checking wallet registration…</div>}
        {success && !isRegistered && <div className="notice success">{success}</div>}
        {error && <div className="notice error">{error}</div>}
        {!isConfigured && <div className="notice error">Deploy the contract before registering.</div>}
        {!isConnected && (
          <div className="notice">
            <p>Connect MetaMask first, then verify the exact wallet address shown above.</p>
            <button
              className="btn btn-primary"
              disabled={isConnecting}
              onClick={connectWallet}
              type="button"
            >
              {isConnecting ? 'Waiting for MetaMask…' : 'Connect MetaMask'}
            </button>
          </div>
        )}
        {isConnected && !isCorrectNetwork && (
          <div className="notice error">
            <p>MetaMask is on the wrong network.</p>
            <button className="btn btn-primary" onClick={switchToExpectedNetwork} type="button">
              Switch to Sepolia
            </button>
          </div>
        )}
        {isConnected && isCorrectNetwork && deploymentStatus !== 'ready' && (
          <div className="notice error">
            The Sepolia escrow contract is not available. Open the setup checklist and run the deployment command.
          </div>
        )}

        {isRegistered ? (
          <>
            <div className="notice success">
              This wallet is registered as <strong>{profile.roleLabel}</strong>: {profile.name}.
            </div>
            <div className="next-actions">
              <Link className="btn btn-primary" to="/dashboard">Open dashboard</Link>
              <button className="btn btn-secondary" onClick={selectWalletForOtherRole} disabled={isConnecting}>
                {isConnecting
                  ? 'Choose account in MetaMask…'
                  : authorizedAccountCount > 1
                    ? `Switch to ${profile.role === 1 ? 'Carrier' : 'Shipper'} wallet`
                    : `Authorize a wallet for ${profile.role === 1 ? 'Carrier' : 'Shipper'}`}
              </button>
            </div>
          </>
        ) : (
          <form className="form-grid" onSubmit={submit}>
            <div>
              <strong>Choose this wallet’s role</strong>
              <div className="role-grid selectable">
                <button className={`role-card ${role === '1' ? 'selected' : ''}`} type="button" onClick={() => chooseRole('1')}>
                  <span className="role-icon">S</span>
                  <strong>Shipper</strong>
                  <small>Creates and funds logistics agreements.</small>
                </button>
                <button className={`role-card ${role === '2' ? 'selected' : ''}`} type="button" onClick={() => chooseRole('2')}>
                  <span className="role-icon">C</span>
                  <strong>Carrier</strong>
                  <small>Completes milestones and receives ETH.</small>
                </button>
                {isDesignatedArbitrator && (
                  <button className={`role-card ${role === '3' ? 'selected' : ''}`} type="button" onClick={() => chooseRole('3')}>
                    <span className="role-icon">A</span>
                    <strong>Arbitrator</strong>
                    <small>Resolves disputed escrow as the contract deployer.</small>
                  </button>
                )}
              </div>
            </div>
            <label>
              Business / Display Name
              <input value={name} onChange={(event) => setName(event.target.value)} required placeholder={role === '1' ? 'Acme Imports' : role === '2' ? 'Swift Freight' : 'ChainCargo Arbitration'} />
            </label>
            {isConnected && (
              <button className="text-button" type="button" onClick={switchWallet} disabled={isConnecting}>
                {authorizedAccountCount > 1
                  ? 'Wrong account? Switch to the other authorized account'
                  : 'Wrong account? Authorize another MetaMask account'}
              </button>
            )}
            <button
              className="btn btn-primary"
              disabled={
                busy ||
                !isConnected ||
                !isConfigured ||
                !isCorrectNetwork ||
                deploymentStatus !== 'ready' ||
                loading
              }
              type="submit"
            >
              {!isConnected
                ? 'Connect MetaMask first'
                : busy
                  ? 'Registering on-chain…'
                  : `Register as ${role === '1' ? 'Shipper' : role === '2' ? 'Carrier' : 'Arbitrator'}`}
            </button>
          </form>
        )}

        <div className="setup-help">
          <strong>To test the complete workflow</strong>
          <p>Register one MetaMask account as Shipper and a different account as Carrier. After the first registration, use the “Select another wallet” button above.</p>
        </div>
        <Link className="back-link" to="/setup">← Back to setup checklist</Link>
      </div>
    </div>
  );
}

export default Register;
