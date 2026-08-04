import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { friendlyContractError, useContract } from '../context/ContractContext';
import { useProfile } from '../hooks/useProfile';
import {
  MAX_MILESTONES,
  MIN_SCHEDULE_BUFFER_MS,
  toDateTimeLocalValue,
  validateAgreementBasics,
  validateAgreementDraft,
} from '../utils/agreementValidation';
import {
  getCarrierReputationTier,
  readCarrierReputation,
} from '../utils/carrierReputation';

const emptyMilestone = () => ({ name: '', details: '', percentage: '', dueAt: '' });

function CreateAgreement() {
  const transactionInFlight = useRef(false);
  const navigate = useNavigate();
  const {
    account,
    isConnected,
    isConnecting,
    connectWallet,
    formatAddress,
    switchWallet,
  } = useWallet();
  const {
    getReadContract,
    getWriteContract,
    isConfigured,
    refreshKey,
    waitForTransaction,
  } = useContract();
  const { isShipper, isRegistered, loading: profileLoading, profile } = useProfile();
  const [form, setForm] = useState({
    title: '',
    carrier: '',
    totalAmount: '',
    deadline: '',
    notes: '',
  });
  const [milestones, setMilestones] = useState([
    { name: 'Pickup confirmed', details: 'Cargo collected from shipper', percentage: '30', dueAt: '' },
    { name: 'Final delivery', details: 'Cargo delivered to destination', percentage: '70', dueAt: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [registeredCarriers, setRegisteredCarriers] = useState([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  const [carrierDirectoryError, setCarrierDirectoryError] = useState('');
  const [minimumDateTime, setMinimumDateTime] = useState('');
  const [step, setStep] = useState(1);

  useEffect(() => {
    const updateMinimum = () => {
      setMinimumDateTime(
        toDateTimeLocalValue(new Date(Date.now() + MIN_SCHEDULE_BUFFER_MS)),
      );
    };
    updateMinimum();
    const timer = window.setInterval(updateMinimum, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isConnected || !isConfigured || !isShipper) {
      setRegisteredCarriers([]);
      return undefined;
    }

    async function loadCarriers() {
      try {
        setCarriersLoading(true);
        setCarrierDirectoryError('');
        const contract = await getReadContract();
        const addresses = await contract.getUsersByRole(2);
        const entries = await Promise.all(
          addresses.map(async (address) => {
            const [carrierProfile, reputation] = await Promise.all([
              contract.getProfile(address),
              readCarrierReputation(contract, address),
            ]);
            return {
              address,
              name: carrierProfile.name,
              reputation,
              reputationTier: reputation === null
                ? 'Redeploy required'
                : getCarrierReputationTier(reputation),
            };
          }),
        );
        if (!cancelled) {
          setRegisteredCarriers(entries);
          setForm((current) => (
            !current.carrier && entries.length === 1
              ? { ...current, carrier: entries[0].address }
              : current
          ));
        }
      } catch (loadError) {
        if (!cancelled) setCarrierDirectoryError(friendlyContractError(loadError));
      } finally {
        if (!cancelled) setCarriersLoading(false);
      }
    }

    loadCarriers();
    return () => {
      cancelled = true;
    };
  }, [getReadContract, isConfigured, isConnected, isShipper, refreshKey]);

  const updateForm = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (name === 'deadline' && value) {
      const deadlineMs = new Date(value).getTime();
      const invalidCount = milestones.filter(
        (milestone) => milestone.dueAt &&
          new Date(milestone.dueAt).getTime() > deadlineMs,
      ).length;
      if (invalidCount) {
        setMilestones((current) => current.map((milestone) => (
          milestone.dueAt && new Date(milestone.dueAt).getTime() > deadlineMs
            ? { ...milestone, dueAt: '' }
            : milestone
        )));
        setError(
          `${invalidCount} milestone date${invalidCount === 1 ? ' was' : 's were'} cleared because it exceeded the new final deadline.`,
        );
      }
    }
  };

  const updateMilestone = (index, field, value) => {
    if (field === 'dueAt' && value) {
      const dueMs = new Date(value).getTime();
      const previousDueAt = index > 0 ? milestones[index - 1].dueAt : '';
      const previousDueMs = previousDueAt ? new Date(previousDueAt).getTime() : 0;
      const deadlineMs = form.deadline ? new Date(form.deadline).getTime() : 0;

      if (previousDueMs && dueMs <= previousDueMs) {
        setError(`Milestone ${index + 1} must be later than milestone ${index}.`);
        return;
      }
      if (deadlineMs && dueMs > deadlineMs) {
        setError(`Milestone ${index + 1} cannot be later than the final deadline.`);
        return;
      }
      setError('');
    }

    setMilestones((current) =>
      current.map((milestone, itemIndex) => {
        if (itemIndex === index) return { ...milestone, [field]: value };
        if (
          field === 'dueAt' &&
          value &&
          itemIndex > index &&
          milestone.dueAt &&
          new Date(milestone.dueAt).getTime() <= new Date(value).getTime()
        ) {
          return { ...milestone, dueAt: '' };
        }
        return milestone;
      }),
    );
  };

  const getMilestoneMinimum = (index) => {
    if (index === 0 || !milestones[index - 1].dueAt) return minimumDateTime;
    const previousDueMs = new Date(milestones[index - 1].dueAt).getTime();
    return toDateTimeLocalValue(new Date(previousDueMs + 60_000));
  };

  const addMilestone = () => {
    if (milestones.length >= MAX_MILESTONES) {
      setError(`An agreement can contain at most ${MAX_MILESTONES} milestones.`);
      return;
    }
    setMilestones((current) => [...current, emptyMilestone()]);
  };

  const removeMilestone = (index) => {
    setMilestones((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const moveToStep = (nextStep) => {
    setError('');
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const continueToMilestones = () => {
    try {
      setError('');
      validateAgreementBasics({ form, account });
      moveToStep(2);
    } catch (validationError) {
      setError(validationError.message);
    }
  };

  const continueToReview = async () => {
    try {
      setBusy(true);
      setError('');
      validateAgreementDraft({ form, milestones, account });
      const contract = await getReadContract();
      const carrierProfile = await contract.getProfile(form.carrier);
      if (Number(carrierProfile.role) !== 2) {
        throw new Error('The carrier wallet must register as a Carrier before you create the agreement.');
      }
      moveToStep(3);
    } catch (validationError) {
      setError(friendlyContractError(validationError));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (step !== 3) return;
    if (!isConnected) {
      await connectWallet();
      return;
    }
    if (!isShipper) {
      setError('Only a wallet registered as a shipper can create agreements.');
      return;
    }
    if (transactionInFlight.current) return;
    transactionInFlight.current = true;

    try {
      setBusy(true);
      const { totalWei, payouts, dueDates, deadline } = validateAgreementDraft({
        form,
        milestones,
        account,
      });
      const readContract = await getReadContract();
      const carrierProfile = await readContract.getProfile(form.carrier);
      if (Number(carrierProfile.role) !== 2) {
        throw new Error('The carrier wallet must register as a Carrier before you create the agreement.');
      }
      const contract = await getWriteContract();
      const transaction = await contract.createAgreement(
        form.title,
        form.carrier,
        deadline,
        form.notes,
        milestones.map((milestone) => milestone.name),
        milestones.map((milestone) => milestone.details),
        payouts,
        dueDates,
        { value: totalWei },
      );
      const receipt = await waitForTransaction(transaction);
      const createdLog = receipt.logs
        .map((log) => {
          try {
            return contract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((log) => log?.name === 'AgreementCreated');
      navigate(`/agreement/${createdLog?.args.agreementId ?? 0}`);
    } catch (submitError) {
      setError(friendlyContractError(submitError));
    } finally {
      transactionInFlight.current = false;
      setBusy(false);
    }
  };

  if (isConnected && !profileLoading && !isRegistered) {
    return (
      <div className="panel access-panel">
        <span className="eyebrow">Registration required</span>
        <h2>Register this wallet before creating an agreement</h2>
        <p>Only a registered Shipper can create and fund logistics agreements.</p>
        <Link className="btn btn-primary" to="/register?role=shipper">Register as Shipper</Link>
      </div>
    );
  }

  if (isConnected && !profileLoading && !isShipper) {
    return (
      <div className="panel access-panel">
        <span className="eyebrow">Current role: {profile?.roleLabel}</span>
        <h2>Only Shippers create agreements</h2>
        <p>Carriers are assigned by a Shipper. They submit milestone evidence and receive payouts after approval.</p>
        <button className="btn btn-primary" onClick={switchWallet} disabled={isConnecting}>
          {isConnecting ? 'Open MetaMask…' : 'Switch to your Shipper wallet'}
        </button>
      </div>
    );
  }

  const allocationTotal = milestones.reduce(
    (sum, milestone) => sum + (Number(milestone.percentage) || 0),
    0,
  );
  const selectedCarrier = registeredCarriers.find(
    (carrier) => carrier.address.toLowerCase() === form.carrier.toLowerCase(),
  );

  return (
    <div className="form-card agreement-wizard">
      <span className="eyebrow">Shipper workflow</span>
      <h2>Create New Agreement</h2>
      <p>Define the shipment, configure payment milestones, then review everything before funding escrow.</p>

      <div className="wizard-steps" aria-label="Agreement creation progress">
        {['Agreement Details', 'Milestones', 'Review & Fund'].map((label, index) => {
          const number = index + 1;
          return (
            <button
              className={`${step === number ? 'active' : ''} ${step > number ? 'complete' : ''}`}
              disabled={number > step}
              key={label}
              onClick={() => number < step && moveToStep(number)}
              type="button"
            >
              <span>{step > number ? '✓' : number}</span>
              {label}
            </button>
          );
        })}
      </div>

      {!isConfigured && <div className="notice error">Deploy the contract before creating agreements.</div>}
      <form className="form-grid" onSubmit={submit}>
        {step === 1 && (
          <section className="wizard-section">
            <div>
              <h3>Agreement Details</h3>
              <p>Enter the parties, total payload/escrow value, and final shipment deadline.</p>
            </div>
            <label>Agreement Name<input name="title" value={form.title} onChange={updateForm} required placeholder="Shipment #001" /></label>
            <label>
              Registered Carrier
              <select
                disabled={carriersLoading || !registeredCarriers.length}
                name="carrier"
                onChange={updateForm}
                required
                value={form.carrier}
              >
                <option value="">
                  {carriersLoading ? 'Loading registered carriers…' : 'Select a Carrier wallet'}
                </option>
                {registeredCarriers.map((carrier) => (
                  <option key={carrier.address} value={carrier.address}>
                    {carrier.name} · {formatAddress(carrier.address)} · {carrier.reputation === null ? 'score unavailable' : `${carrier.reputation.toString()} pts`}
                  </option>
                ))}
              </select>
              <small>
                Only wallets registered on-chain as Carrier are listed. Found {registeredCarriers.length}.
              </small>
            </label>
            {selectedCarrier && (
              <div className="carrier-reputation-preview">
                <span className="reputation-mark">★</span>
                <span>
                  <small>On-chain carrier reputation</small>
                  <strong>
                    {selectedCarrier.reputation === null
                      ? 'Redeploy the updated contract to enable points'
                      : `${selectedCarrier.reputation.toString()} points · ${selectedCarrier.reputationTier}`}
                  </strong>
                </span>
                <small>Earned only when Shippers approve completed milestones.</small>
              </div>
            )}
            {carrierDirectoryError && <div className="notice error">{carrierDirectoryError}</div>}
            {!carriersLoading && !registeredCarriers.length && !carrierDirectoryError && (
              <div className="notice">
                No Carrier is registered yet. Open Setup, authorize a second MetaMask account,
                and register it as Carrier before continuing.
              </div>
            )}
            <label>
              Total Payload / Escrow Value (ETH)
              <input name="totalAmount" value={form.totalAmount} onChange={updateForm} required min="0.000001" step="any" type="number" placeholder="10" />
              <small>The full payable value is locked in the smart contract and divided across milestones.</small>
            </label>
            <label>
              Final Delivery Deadline
              <input name="deadline" value={form.deadline} onChange={updateForm} required min={minimumDateTime} type="datetime-local" />
              <small>Must be at least 2 minutes from now.</small>
            </label>
            <label>Agreement Notes<textarea name="notes" value={form.notes} onChange={updateForm} rows="4" placeholder="Add shipment instructions" /></label>
            <div className="wizard-actions">
              <button className="btn btn-primary" type="button" onClick={continueToMilestones}>Continue to Milestones</button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="wizard-section">
            <div className="section-heading">
              <div>
                <h3>Payment Milestones</h3>
                <p>Split the {form.totalAmount || '0'} ETH escrow across verifiable shipment checkpoints.</p>
                <small>Due dates must be chronological and no later than the final deadline.</small>
              </div>
              <button className="btn btn-secondary" disabled={milestones.length >= MAX_MILESTONES} type="button" onClick={addMilestone}>Add milestone</button>
            </div>
            {milestones.map((milestone, index) => (
              <div className="milestone-editor" key={`milestone-${index}`}>
                <div className="section-heading">
                  <strong>Milestone {index + 1}</strong>
                  <span className="badge">{milestone.percentage || 0}% of escrow</span>
                </div>
                <label>Name<input required value={milestone.name} onChange={(event) => updateMilestone(index, 'name', event.target.value)} /></label>
                <label>Evidence required<input required value={milestone.details} onChange={(event) => updateMilestone(index, 'details', event.target.value)} /></label>
                <div className="grid grid-2">
                  <label>Payout (%)<input required min="1" max="100" type="number" value={milestone.percentage} onChange={(event) => updateMilestone(index, 'percentage', event.target.value)} /></label>
                  <label>
                    Due date
                    <input
                      required
                      min={getMilestoneMinimum(index)}
                      max={form.deadline || undefined}
                      step="60"
                      type="datetime-local"
                      value={milestone.dueAt}
                      onChange={(event) => updateMilestone(index, 'dueAt', event.target.value)}
                    />
                    <small>
                      {index === 0
                        ? 'Must be in the future and no later than the final deadline.'
                        : `Must be later than milestone ${index} and no later than the final deadline.`}
                    </small>
                  </label>
                </div>
                {milestones.length > 1 && <button className="text-button danger" type="button" onClick={() => removeMilestone(index)}>Remove</button>}
              </div>
            ))}
            <div className={`percentage-summary ${allocationTotal === 100 ? 'valid' : 'invalid'}`}>
              <span>Total payout allocation</span>
              <strong>{allocationTotal}%</strong>
            </div>
            <div className="wizard-actions">
              <button className="btn btn-secondary" type="button" onClick={() => moveToStep(1)}>Back to Details</button>
              <button className="btn btn-primary" disabled={busy} type="button" onClick={continueToReview}>
                {busy ? 'Checking agreement…' : 'Review Agreement'}
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="wizard-section">
            <div>
              <h3>Review & Fund</h3>
              <p>Check the final terms. MetaMask deposits the full escrow only after you confirm.</p>
            </div>
            <div className="review-grid">
              <div><small>Agreement</small><strong>{form.title}</strong></div>
              <div><small>Payload / escrow value</small><strong>{form.totalAmount} ETH</strong></div>
              <div><small>Carrier</small><code>{form.carrier}</code></div>
              <div>
                <small>Carrier reputation</small>
                <strong>
                  {selectedCarrier?.reputation === null || !selectedCarrier
                    ? 'Unavailable until redeployment'
                    : `${selectedCarrier.reputation.toString()} points · ${selectedCarrier.reputationTier}`}
                </strong>
              </div>
              <div><small>Final deadline</small><strong>{new Date(form.deadline).toLocaleString()}</strong></div>
            </div>
            <div className="review-milestones">
              {milestones.map((milestone, index) => (
                <div className="review-milestone" key={`review-${index}`}>
                  <span><strong>{index + 1}. {milestone.name}</strong><small>{milestone.details}</small></span>
                  <span><strong>{milestone.percentage}%</strong><small>{new Date(milestone.dueAt).toLocaleString()}</small></span>
                </div>
              ))}
            </div>
            <div className="notice">
              Milestone terms become immutable after confirmation. Creating this agreement requires exactly one MetaMask transaction.
            </div>
            <div className="wizard-actions">
              <button className="btn btn-secondary" type="button" onClick={() => moveToStep(2)}>Edit Milestones</button>
              <button className="btn btn-primary" disabled={busy || !isConfigured} type="submit">
                {busy ? 'Confirming transaction…' : `Fund & Create (${form.totalAmount || '0'} ETH)`}
              </button>
            </div>
          </section>
        )}
        {error && <div className="notice error">{error}</div>}
      </form>
    </div>
  );
}

export default CreateAgreement;
