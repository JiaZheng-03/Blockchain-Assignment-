import { useEffect, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { useContract } from '../context/ContractContext';
import { ROLE_LABELS } from '../contracts/abi';
import { addressesEqual } from '../utils/address';

function AccountPermissionDialog() {
  const {
    authorizeAdditionalAccount,
    account,
    accountPermissionMode,
    authorizedAccounts,
    closeAccountPermissionHelp,
    closeAccountSwitcher,
    formatAddress,
    selectAuthorizedAccount,
    showAccountPermissionHelp,
    showAccountSwitcher,
  } = useWallet();
  const { getReadContract, isConfigured } = useContract();
  const [profiles, setProfiles] = useState({});
  const [profilesLoading, setProfilesLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!showAccountSwitcher || !isConfigured) return undefined;

    async function loadProfiles() {
      try {
        setProfilesLoading(true);
        const contract = await getReadContract();
        const [arbitratorAddress, entries] = await Promise.all([
          contract.arbitrator(),
          Promise.all(
            authorizedAccounts.map(async (address) => {
              const profile = await contract.getProfile(address);
              return [address.toLowerCase(), {
                name: profile.name,
                role: Number(profile.role),
              }];
            }),
          ),
        ]);
        if (!cancelled) {
          setProfiles(Object.fromEntries(entries.map(([address, profile]) => [
            address,
            { ...profile, isArbitrator: addressesEqual(address, arbitratorAddress) },
          ])));
        }
      } catch {
        if (!cancelled) setProfiles({});
      } finally {
        if (!cancelled) setProfilesLoading(false);
      }
    }

    loadProfiles();
    return () => {
      cancelled = true;
    };
  }, [authorizedAccounts, getReadContract, isConfigured, showAccountSwitcher]);

  if (!showAccountPermissionHelp && !showAccountSwitcher) return null;

  if (showAccountSwitcher) {
    return (
      <div className="dialog-backdrop" role="presentation">
        <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="switch-dialog-title">
          <span className="eyebrow">Authorized MetaMask accounts</span>
          <h2 id="switch-dialog-title">Choose the exact wallet role</h2>
          <p>CargoSeal will never guess which account you mean. Select the registered address you want to use.</p>
          {profilesLoading && <div className="notice">Checking on-chain roles for each address…</div>}
          <div className="account-choice-list">
            {authorizedAccounts.map((address) => {
              const profile = profiles[address.toLowerCase()];
              const isCurrent = address.toLowerCase() === account?.toLowerCase();
              return (
                <button
                  className={`account-choice ${isCurrent ? 'current' : ''}`}
                  key={address}
                  type="button"
                  disabled={profilesLoading}
                  onClick={() => selectAuthorizedAccount(address)}
                >
                  <span>
                    <strong>
                      {profilesLoading
                        ? 'Checking role…'
                        : profile?.isArbitrator
                          ? 'Arbitrator'
                          : profile?.role
                            ? ROLE_LABELS[profile.role]
                            : 'Unregistered'}
                    </strong>
                    <small>
                      {profilesLoading
                        ? 'Reading contract profile'
                        : profile?.isArbitrator
                          ? 'Contract deployer'
                          : profile?.name || 'No on-chain profile'}
                    </small>
                  </span>
                  <code>{formatAddress(address)}</code>
                  {isCurrent && <span className="badge">Current</span>}
                </button>
              );
            })}
          </div>
          <div className="dialog-actions">
            <button className="btn btn-danger" type="button" onClick={closeAccountSwitcher}>Cancel</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
        <span className="eyebrow">MetaMask account access</span>
        <h2 id="account-dialog-title">
          {accountPermissionMode === 'manage' ? 'Manage linked accounts' : 'Authorize your second testing account'}
        </h2>
        <p>You are already connected. MetaMask will use the phrase “Connect this website” because CargoSeal is updating which addresses this site may access.</p>
        <ol className="dialog-steps">
          <li>Click <strong>Continue to MetaMask</strong> below.</li>
          <li>In MetaMask, click <strong>Edit accounts</strong>.</li>
          <li>
            {accountPermissionMode === 'manage'
              ? <>Select only the accounts you want linked and deselect unwanted accounts.</>
              : <>Select <strong>both</strong> imported accounts.</>}
          </li>
          <li>Click <strong>Connect</strong>.</li>
        </ol>
        <div className="notice">Changing site access does not delete an address’s on-chain registration or agreements.</div>
        <div className="dialog-actions">
          <button className="btn btn-danger" type="button" onClick={closeAccountPermissionHelp}>Cancel</button>
          <button className="btn btn-primary" type="button" onClick={authorizeAdditionalAccount}>Continue to MetaMask</button>
        </div>
      </section>
    </div>
  );
}

export default AccountPermissionDialog;
