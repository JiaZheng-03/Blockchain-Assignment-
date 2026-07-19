import { Link } from 'react-router-dom';

function Register() {
  return (
    <div className="form-card" style={{ maxWidth: 520, margin: '2rem auto' }}>
      <h3>Create Your Account</h3>
      <p>Register as a shipper or carrier to start using ChainCargo.</p>
      <form className="form-grid">
        <label>
          Full Name
          <input type="text" placeholder="Jane Doe" />
        </label>
        <label>
          Email
          <input type="email" placeholder="you@example.com" />
        </label>
        <label>
          Role
          <select defaultValue="shipper">
            <option value="shipper">Shipper</option>
            <option value="carrier">Carrier</option>
          </select>
        </label>
        <label>
          Password
          <input type="password" placeholder="Create a password" />
        </label>
        <button className="btn btn-primary" type="submit">
          Register
        </button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        Already have an account? <Link to="/login">Login</Link>
      </p>
    </div>
  );
}

export default Register;
