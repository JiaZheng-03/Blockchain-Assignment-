function CreateAgreement() {
  return (
    <div className="form-card" style={{ maxWidth: 640, margin: '0 auto' }}>
      <h3>Create New Agreement</h3>
      <p>Set up a milestone-based escrow contract for your shipment.</p>
      <form className="form-grid">
        <label>
          Agreement Name
          <input type="text" placeholder="Shipment #001" />
        </label>
        <label>
          Carrier Address
          <input type="text" placeholder="0x..." />
        </label>
        <label>
          Total Amount (ETH)
          <input type="number" placeholder="10" />
        </label>
        <label>
          Deadline
          <input type="date" />
        </label>
        <label>
          Agreement Notes
          <textarea rows="4" placeholder="Add shipment instructions" />
        </label>
        <button className="btn btn-primary" type="submit">
          Create Agreement
        </button>
      </form>
    </div>
  );
}

export default CreateAgreement;
