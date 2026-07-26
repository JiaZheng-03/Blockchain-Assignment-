import { useParams } from 'react-router-dom';
import MilestoneCard from '../components/MilestoneCard';
import { useWallet } from '../context/WalletContext';

function AgreementDetail() {
  const { id } = useParams();
  const { isConnected, account, formatAddress } = useWallet();

  const milestones = [
    { title: 'Pickup Confirmed', description: 'Carrier picked up the goods', percentage: 30, status: 'Completed' },
    { title: 'In Transit', description: 'Shipment is moving to destination', percentage: 30, status: 'Pending' },
    { title: 'Delivery Verified', description: 'Receiver confirms final delivery', percentage: 40, status: 'Pending' },
  ];

  // Mock shipper and carrier addresses for demo
  const mockShipper = '0x1234567890123456789012345678901234567890';
  const mockCarrier = '0x0987654321098765432109876543210987654321';
  const isShipper = isConnected && account?.toLowerCase() === mockShipper.toLowerCase();
  const isCarrier = isConnected && account?.toLowerCase() === mockCarrier.toLowerCase();

  return (
    <section className="grid grid-2">
      <div className="panel">
        <h3>Agreement #{id}</h3>
        <p>Shipper: {formatAddress(mockShipper)}</p>
        <p>Carrier: {formatAddress(mockCarrier)}</p>
        <p>Total Amount: 10 ETH</p>
        <p>Status: <span className="badge">In Progress</span></p>
        {isConnected && (
          <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#0369a1' }}>
            {isShipper && '✓ You are the shipper'}
            {isCarrier && '✓ You are the carrier'}
            {!isShipper && !isCarrier && `Your address: ${formatAddress(account)}`}
          </p>
        )}
      </div>
      <div className="panel">
        <h3>Milestones</h3>
        <div className="list">
          {milestones.map((milestone) => (
            <MilestoneCard key={milestone.title} {...milestone} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default AgreementDetail;
