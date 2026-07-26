import { useState } from 'react';
import { useWallet } from '../context/WalletContext';

function CreateAgreement() {
  const { isConnected, account, formatAddress, networkName } = useWallet();
  const [formData, setFormData] = useState({
    name: '',
    carrier: '',
    amount: '',
    deadline: '',
    notes: '',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isConnected) {
      alert('Please connect your wallet first.');
      return;
    }
    console.log('Agreement data:', {
      shipper: account,
      ...formData,
    });
    alert('Agreement creation submitted. (This is a demo - no real transaction)');
  };

  if (!isConnected) {
    return (
      <div className="form-card" style={{ maxWidth: 640, margin: '0 auto' }}>
        <h3>Create New Agreement</h3>
        <p style={{ color: '#dc2626' }}>Connect your MetaMask wallet to create an agreement.</p>
      </div>
    );
  }

  return (
    <div className="form-card" style={{ maxWidth: 640, margin: '0 auto' }}>
      <h3>Create New Agreement</h3>
      <p>Set up a milestone-based escrow contract for your shipment.</p>
      <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f0f9ff', borderRadius: '0.5rem' }}>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Your Address:</strong> {formatAddress(account)}
        </p>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Network:</strong> {networkName}
        </p>
      </div>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Agreement Name
          <input
            type="text"
            name="name"
            placeholder="Shipment #001"
            value={formData.name}
            onChange={handleChange}
          />
        </label>
        <label>
          Carrier Address
          <input
            type="text"
            name="carrier"
            placeholder="0x..."
            value={formData.carrier}
            onChange={handleChange}
          />
        </label>
        <label>
          Total Amount (ETH)
          <input
            type="number"
            name="amount"
            placeholder="10"
            value={formData.amount}
            onChange={handleChange}
          />
        </label>
        <label>
          Deadline
          <input
            type="date"
            name="deadline"
            value={formData.deadline}
            onChange={handleChange}
          />
        </label>
        <label>
          Agreement Notes
          <textarea
            name="notes"
            rows="4"
            placeholder="Add shipment instructions"
            value={formData.notes}
            onChange={handleChange}
          />
        </label>
        <button className="btn btn-primary" type="submit">
          Create Agreement
        </button>
      </form>
    </div>
  );
}

export default CreateAgreement;
