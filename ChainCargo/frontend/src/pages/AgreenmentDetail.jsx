import { useParams } from 'react-router-dom';
import MilestoneCard from '../components/MilestoneCard';

function AgreementDetail() {
  const { id } = useParams();

  const milestones = [
    { title: 'Pickup Confirmed', description: 'Carrier picked up the goods', percentage: 30, status: 'Completed' },
    { title: 'In Transit', description: 'Shipment is moving to destination', percentage: 30, status: 'Pending' },
    { title: 'Delivery Verified', description: 'Receiver confirms final delivery', percentage: 40, status: 'Pending' },
  ];

  return (
    <section className="grid grid-2">
      <div className="panel">
        <h3>Agreement #{id}</h3>
        <p>Shipper: 0xShipper...</p>
        <p>Carrier: 0xCarrier...</p>
        <p>Total Amount: 10 ETH</p>
        <p>Status: <span className="badge">In Progress</span></p>
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
