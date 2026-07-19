function MilestoneCard({ title, description, percentage, status }) {
  return (
    <div className="list-item">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div>
        <p>{percentage}%</p>
        <span className="badge">{status}</span>
      </div>
    </div>
  );
}

export default MilestoneCard;
