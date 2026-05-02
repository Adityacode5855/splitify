import json
import os
import re
from datetime import datetime, timedelta
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

# Cloudinary imports moved to function to speed up Vercel startup

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_PATH = os.path.join(BASE_DIR, "database.db")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "splitify-default-secret-key-123")

# Support for Vercel/Production: Use DATABASE_URL if available
db_url = os.environ.get("DATABASE_URL", "").strip()

# Remove common copy-paste errors
if db_url.startswith("DATABASE_URL="):
    db_url = db_url.replace("DATABASE_URL=", "", 1)
db_url = db_url.replace('"', '').replace("'", "")

if db_url and db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = db_url or ("sqlite:///" + DATABASE_PATH.replace("\\", "/"))

app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

db = SQLAlchemy(app)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=True)
    profile_image = db.Column(db.String(255), nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "profile_image": self.profile_image
        }

class Group(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    members = db.Column(db.Text, nullable=False)  # Stored as JSON string
    expenses = db.relationship('Expense', backref='group', lazy=True, cascade="all, delete-orphan")
    settlements = db.relationship('Settlement', backref='group', lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "members": json.loads(self.members) if self.members else [],
            "expenses": [e.to_dict() for e in self.expenses],
            "settlements": [s.to_dict() for s in self.settlements]
        }

class Expense(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    group_id = db.Column(db.String(36), db.ForeignKey('group.id'), nullable=False)
    payer = db.Column(db.String(120), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    description = db.Column(db.String(255), nullable=False)
    icon = db.Column(db.String(10), nullable=True)
    split_type = db.Column(db.String(20), default="equal") # "equal", "exact"
    split_data = db.Column(db.Text, nullable=True) # JSON string
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "group_id": self.group_id,
            "payer": self.payer,
            "amount": self.amount,
            "desc": self.description,
            "icon": self.icon,
            "split_type": self.split_type,
            "split_data": json.loads(self.split_data) if self.split_data else {},
            "created_at": self.created_at.isoformat()
        }
    
class Settlement(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    group_id = db.Column(db.String(36), db.ForeignKey('group.id'), nullable=False)
    from_user = db.Column(db.String(120), nullable=False)
    to_user = db.Column(db.String(120), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "group_id": self.group_id,
            "from_user": self.from_user,
            "to_user": self.to_user,
            "amount": self.amount,
            "created_at": self.created_at.isoformat()
        }

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return db.session.get(User, user_id)


def login_user(user, remember=False):
    session.clear()
    session["user_id"] = user.id
    session.permanent = bool(remember)


def login_required(route):
    @wraps(route)
    def wrapper(*args, **kwargs):
        if not current_user():
            if request.path.startswith("/api/"):
                return jsonify({"error": "Please log in first."}), 401
            return redirect(url_for("home"))
        return route(*args, **kwargs)

    return wrapper


def json_data():
    return request.get_json(silent=True) or {}


def clean_email(value):
    return (value or "").strip().lower()


def validate_email_password(email, password):
    if not EMAIL_RE.match(email):
        return "Please enter a valid email address."
    if not email.endswith("@gmail.com"):
        return "Only Gmail addresses ending with @gmail.com are allowed."
    if len(password) < 6:
        return "Password must be at least 6 characters."
    return None


def ensure_user_columns():
    if "sqlite" not in str(db.engine.url).lower():
        return # Skip for Postgres/other
    try:
        inspector_rows = db.session.execute(text("PRAGMA table_info(user)")).fetchall()
        columns = {row[1] for row in inspector_rows}
        if inspector_rows:
            if "password_hash" not in columns:
                db.session.execute(text("ALTER TABLE user ADD COLUMN password_hash VARCHAR(255)"))
            if "profile_image" not in columns:
                db.session.execute(text("ALTER TABLE user ADD COLUMN profile_image VARCHAR(255)"))
            db.session.commit()
    except Exception as e:
        print(f"Migration Error (User): {e}")


def ensure_expense_columns():
    if "sqlite" not in str(db.engine.url).lower():
        return # Skip for Postgres/other
    try:
        inspector_rows = db.session.execute(text("PRAGMA table_info(expense)")).fetchall()
        columns = {row[1] for row in inspector_rows}
        if inspector_rows:
            if "split_type" not in columns:
                db.session.execute(text("ALTER TABLE expense ADD COLUMN split_type VARCHAR(20) DEFAULT 'equal'"))
            if "split_data" not in columns:
                db.session.execute(text("ALTER TABLE expense ADD COLUMN split_data TEXT"))
            db.session.commit()
    except Exception as e:
        print(f"Migration Error (Expense): {e}")



@app.errorhandler(Exception)
def handle_unexpected_error(error):
    if isinstance(error, HTTPException):
        return error
    app.logger.exception(error)
    return jsonify({"error": str(error)}), 500

@app.route("/")
def home():
    if current_user():
        return redirect(url_for("dashboard"))
    return render_template("index.html")


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("index.html")


@app.route("/api/me")
def api_me():
    user = current_user()
    if not user:
        return jsonify({"error": "Not logged in."}), 401
    return jsonify({"user": user.to_dict()})


@app.route("/api/register", methods=["POST"])
def api_register():
    data = json_data()
    name = (data.get("name") or "").strip()
    email = clean_email(data.get("email"))
    password = data.get("password") or ""
    remember = bool(data.get("remember"))

    if len(name) < 2:
        return jsonify({"error": "Please enter your full name."}), 400

    error = validate_email_password(email, password)
    if error:
        return jsonify({"error": error}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({"error": "An account with this Gmail already exists."}), 409

    user = User(
        name=name,
        email=email,
        password_hash=generate_password_hash(password),
    )
    db.session.add(user)
    db.session.commit()
    login_user(user, remember=remember)

    return jsonify({"message": "Account created successfully.", "user": user.to_dict()}), 201


@app.route("/api/login", methods=["POST"])
def api_login():
    data = json_data()
    email = clean_email(data.get("email"))
    password = data.get("password") or ""
    remember = bool(data.get("remember"))

    if not email or not EMAIL_RE.match(email) or not email.endswith("@gmail.com"):
        return jsonify({"error": "Please enter a valid Gmail address ending with @gmail.com."}), 400

    if not password:
        return jsonify({"error": "Password is required."}), 400

    user = User.query.filter_by(email=email).first()
    if not user or not user.password_hash or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid Gmail address or password."}), 401

    login_user(user, remember=remember)
    return jsonify({"message": "Logged in successfully.", "user": user.to_dict()})


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"message": "Logged out successfully."})


# --- NEW GROUP & EXPENSE APIS ---

@app.route("/api/groups", methods=["GET"])
@login_required
def get_groups():
    user = current_user()
    groups = Group.query.filter_by(user_id=user.id).order_by(Group.id.desc()).all()
    return jsonify({"groups": [g.to_dict() for g in groups]})


@app.route("/api/groups", methods=["POST"])
@login_required
def create_group():
    data = json_data()
    user = current_user()
    
    group_id = data.get("id")
    name = data.get("name")
    members = data.get("members", [])
    
    if not name or not members:
        return jsonify({"error": "Group name and members are required."}), 400

    new_group = Group(
        id=group_id,
        name=name,
        user_id=user.id,
        members=json.dumps(members)
    )
    db.session.add(new_group)
    db.session.commit()
    
    return jsonify({"message": "Group created successfully.", "group": new_group.to_dict()}), 201


@app.route("/api/groups/<group_id>", methods=["DELETE"])
@login_required
def delete_group(group_id):
    user = current_user()
    group = Group.query.filter_by(id=group_id, user_id=user.id).first()
    if not group:
        return jsonify({"error": "Group not found or unauthorized."}), 404

    db.session.delete(group)
    db.session.commit()
    
    return jsonify({"message": "Group deleted successfully."})


@app.route("/api/expenses", methods=["POST"])
@login_required
def add_expense():
    data = json_data()
    user = current_user()
    
    expense_id = data.get("id")
    group_id = data.get("group_id")
    payer = data.get("payer")
    amount = data.get("amount")
    description = data.get("desc")
    icon = data.get("icon")
    split_type = data.get("split_type", "equal")
    split_data = data.get("split_data")
    
    # Verify the group belongs to the current user
    group = Group.query.filter_by(id=group_id, user_id=user.id).first()
    if not group:
        return jsonify({"error": "Group not found or unauthorized."}), 404

    # Validation
    if not split_data:
        return jsonify({"error": "Split details are required."}), 400
        
    if split_type == "exact":
        total_split = sum(float(val) for val in split_data.values())
        if abs(total_split - float(amount)) > 0.01:
            return jsonify({"error": f"Sum of exact splits ({total_split}) must equal total amount ({amount})."}), 400
    elif split_type == "equal":
        if not isinstance(split_data, list) or len(split_data) == 0:
            return jsonify({"error": "Select at least one participant."}), 400

    new_expense = Expense(
        id=expense_id,
        group_id=group_id,
        payer=payer,
        amount=amount,
        description=description,
        icon=icon,
        split_type=split_type,
        split_data=json.dumps(split_data)
    )
    db.session.add(new_expense)
    db.session.commit()
    
    return jsonify({"message": "Expense added successfully.", "expense": new_expense.to_dict()}), 201


@app.route("/api/expenses/<group_id>", methods=["GET"])
@login_required
def get_expenses(group_id):
    user = current_user()
    group = Group.query.filter_by(id=group_id, user_id=user.id).first()
    if not group:
        return jsonify({"error": "Group not found or unauthorized."}), 404
        
    return jsonify({"expenses": [e.to_dict() for e in group.expenses]})
    
@app.route("/api/settle", methods=["POST"])
@login_required
def settle_up():
    data = json_data()
    user = current_user()
    
    group_id = data.get("group_id")
    from_user = data.get("from_user")
    to_user = data.get("to_user")
    amount = data.get("amount")
    
    if not amount or amount <= 0:
        return jsonify({"error": "Amount must be greater than zero."}), 400
        
    group = Group.query.filter_by(id=group_id, user_id=user.id).first()
    if not group:
        return jsonify({"error": "Group not found or unauthorized."}), 404

    # Generate a unique ID if not provided
    settlement_id = data.get("id") or (datetime.utcnow().strftime("%Y%m%d%H%M%S") + os.urandom(4).hex())

    new_settlement = Settlement(
        id=settlement_id,
        group_id=group_id,
        from_user=from_user,
        to_user=to_user,
        amount=float(amount)
    )
    db.session.add(new_settlement)
    db.session.commit()
    
    return jsonify({"message": "Payment recorded successfully.", "settlement": new_settlement.to_dict()}), 201


@app.route("/api/settlements/<group_id>", methods=["GET"])
@login_required
def get_settlements(group_id):
    user = current_user()
    group = Group.query.filter_by(id=group_id, user_id=user.id).first()
    if not group:
        return jsonify({"error": "Group not found or unauthorized."}), 404
        
    return jsonify({"settlements": [s.to_dict() for s in group.settlements]})


@app.route("/api/summary/<group_id>", methods=["GET"])
@login_required
def get_summary(group_id):
    user = current_user()
    group = Group.query.filter_by(id=group_id, user_id=user.id).first()
    if not group:
        return jsonify({"error": "Group not found or unauthorized."}), 404
    
    members = json.loads(group.members)
    balances = {m: 0.0 for m in members}
    
    # 1. Process Expenses
    for exp in group.expenses:
        balances[exp.payer] += exp.amount
        
        # Handle legacy expenses and missing split data
        s_type = exp.split_type or "equal"
        s_data = json.loads(exp.split_data) if exp.split_data else None
        
        if s_type == "equal":
            # If no participants list is stored, default to all members
            participants = s_data if (isinstance(s_data, list) and len(s_data) > 0) else members
            if len(participants) > 0:
                share = exp.amount / len(participants)
                for m in participants:
                    # Double check member exists in current group
                    if m in balances:
                        balances[m] -= share
        elif s_type == "exact":
            splits = s_data if isinstance(s_data, dict) else {}
            for m, val in splits.items():
                if m in balances:
                    balances[m] -= float(val)
            
    # 2. Process Settlements (Payments)
    for s in group.settlements:
        balances[s.from_user] += s.amount
        balances[s.to_user] -= s.amount
        
    # 3. Calculate suggested payments (who owes who)
    pos = []
    neg = []
    for m, b in balances.items():
        if b > 0.005: pos.append({"m": m, "b": b})
        if b < -0.005: neg.append({"m": m, "b": -b})
        
    suggested = []
    pi, ni = 0, 0
    while pi < len(pos) and ni < len(neg):
        p, n = pos[pi], neg[ni]
        amt = min(p["b"], n["b"])
        suggested.append({"from": n["m"], "to": p["m"], "amount": amt})
        p["b"] -= amt
        n["b"] -= amt
        if p["b"] < 0.005: pi += 1
        if n["b"] < 0.005: ni += 1
        
    return jsonify({
        "balances": balances,
        "suggested": suggested,
        "settlements": [s.to_dict() for s in group.settlements]
    })

@app.route("/api/dashboard", methods=["GET"])
@login_required
def get_dashboard_summary():
    user = current_user()
    groups = Group.query.filter_by(user_id=user.id).all()
    
    total_you_owe = 0.0
    total_you_are_owed = 0.0
    total_spent = 0.0
    expense_count = 0
    group_count = len(groups)
    
    all_activity = []
    category_totals = {"Food": 0.0, "Travel": 0.0, "Entertainment": 0.0, "Other": 0.0}
    who_owes_me = {} # {member_name: amount}

    for group in groups:
        members = json.loads(group.members)
        balances = {m: 0.0 for m in members}
        
        for exp in group.expenses:
            expense_count += 1
            if exp.payer == user.name:
                total_spent += exp.amount
            
            # Categorization
            desc = exp.description.lower()
            cat = "Other"
            if any(k in desc for k in ["food", "dinner", "lunch", "pizza", "restaurant", "eat", "drink", "cafe"]):
                cat = "Food"
            elif any(k in desc for k in ["uber", "travel", "cab", "ola", "train", "flight", "petrol", "fuel", "bus"]):
                cat = "Travel"
            elif any(k in desc for k in ["movie", "game", "show", "netflix", "party", "club"]):
                cat = "Entertainment"
            category_totals[cat] += exp.amount

            # Balances
            balances[exp.payer] += exp.amount
            s_type = exp.split_type or "equal"
            s_data = json.loads(exp.split_data) if exp.split_data else None
            
            if s_type == "equal":
                participants = s_data if (isinstance(s_data, list) and len(s_data) > 0) else members
                share = exp.amount / len(participants)
                for m in participants:
                    if m in balances: balances[m] -= share
            elif s_type == "exact":
                splits = s_data if isinstance(s_data, dict) else {}
                for m, val in splits.items():
                    if m in balances: balances[m] -= float(val)
            
            # Activity log entry
            all_activity.append({
                "type": "expense",
                "payer": exp.payer,
                "amount": exp.amount,
                "desc": exp.description,
                "group_name": group.name,
                "created_at": exp.created_at.isoformat()
            })

        for s in group.settlements:
            balances[s.from_user] += s.amount
            balances[s.to_user] -= s.amount
            all_activity.append({
                "type": "settlement",
                "from_user": s.from_user,
                "to_user": s.to_user,
                "amount": s.amount,
                "group_name": group.name,
                "created_at": s.created_at.isoformat()
            })
            
        # Overall totals
        user_balance = balances.get(user.name, 0.0)
        if user_balance > 0.005:
            total_you_are_owed += user_balance
        elif user_balance < -0.005:
            total_you_owe += abs(user_balance)
            
        # Track who owes me most
        for m, bal in balances.items():
            if m != user.name and bal < -0.005:
                who_owes_me[m] = who_owes_me.get(m, 0.0) + abs(bal)

    # Sort activity
    all_activity.sort(key=lambda x: x["created_at"], reverse=True)
    recent_activity = all_activity[:10]

    # Generate Insights
    insights = []
    if category_totals:
        top_cat = max(category_totals, key=category_totals.get)
        if category_totals[top_cat] > 0:
            insights.append(f"You spent most on {top_cat} (₹{category_totals[top_cat]:.0f})")
    
    if who_owes_me:
        top_debtor = max(who_owes_me, key=who_owes_me.get)
        if who_owes_me[top_debtor] > 0:
            insights.append(f"{top_debtor} owes you the most (₹{who_owes_me[top_debtor]:.0f})")
            
    if total_spent > 5000:
        insights.append("Proactive tip: You've spent over ₹5000 this month.")
    elif expense_count == 0:
        insights.append("Welcome! Add your first expense to see insights.")

    return jsonify({
        "you_owe": total_you_owe,
        "you_are_owed": total_you_are_owed,
        "total_spent": total_spent,
        "expense_count": expense_count,
        "group_count": group_count,
        "recent_activity": recent_activity,
        "category_breakdown": category_totals,
        "insights": insights
    })


@app.route("/api/expenses/all", methods=["GET"])
@login_required
def get_all_expenses():
    user = current_user()
    groups = Group.query.filter_by(user_id=user.id).all()
    
    all_activity = []
    for group in groups:
        for exp in group.expenses:
            all_activity.append({
                "type": "expense",
                "payer": exp.payer,
                "amount": exp.amount,
                "desc": exp.description,
                "group_name": group.name,
                "created_at": exp.created_at.isoformat()
            })
        for s in group.settlements:
            all_activity.append({
                "type": "settlement",
                "from_user": s.from_user,
                "to_user": s.to_user,
                "amount": s.amount,
                "group_name": group.name,
                "created_at": s.created_at.isoformat()
            })
            
    all_activity.sort(key=lambda x: x["created_at"], reverse=True)
    return jsonify({"activity": all_activity})


# --------------------------------


@app.route("/api/profile", methods=["GET"])
@login_required
def get_profile():
    return jsonify(current_user().to_dict())

@app.route("/api/profile", methods=["PUT"])
@login_required
def update_profile():
    data = json_data()
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name cannot be empty."}), 400
    
    user = current_user()
    user.name = name
    db.session.commit()
    return jsonify(user.to_dict())

@app.route("/api/profile/password", methods=["PUT"])
@login_required
def update_password():
    data = json_data()
    curr_pw = data.get("current_password")
    new_pw = data.get("new_password")
    
    if not curr_pw or not new_pw:
        return jsonify({"error": "Missing password fields."}), 400
    
    user = current_user()
    if not check_password_hash(user.password_hash, curr_pw):
        return jsonify({"error": "Current password incorrect."}), 401
    
    if len(new_pw) < 6:
        return jsonify({"error": "New password must be at least 6 characters."}), 400
    
    user.password_hash = generate_password_hash(new_pw)
    db.session.commit()
    return jsonify({"success": True})

@app.route("/api/profile/upload", methods=["POST"])
@login_required
def upload_profile_image():
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400
    
    if not file.content_type.startswith("image/"):
        return jsonify({"error": "Only image files are allowed."}), 400

    user = current_user()

    # --- Cloudinary Upload (Recommended for Vercel) ---
    if os.environ.get("CLOUDINARY_URL"):
        import cloudinary
        import cloudinary.uploader
        try:
            upload_result = cloudinary.uploader.upload(
                file,
                folder="splitify_avatars/",
                public_id=f"user_{user.id}_{int(datetime.utcnow().timestamp())}",
                overwrite=True,
                resource_type="image"
            )
            image_url = upload_result.get("secure_url")
            user.profile_image = image_url
            db.session.commit()
            return jsonify({"profile_image": image_url})
        except Exception as e:
            print(f"Cloudinary Error: {e}")
            # Continue to local fallback if cloud fails during dev

    # --- Local Fallback (For Local Development) ---
    upload_folder = os.path.join(app.static_folder, "uploads")
    if not os.path.exists(upload_folder):
        os.makedirs(upload_folder)
    
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "jpg"
    filename = f"user_{user.id}_{int(datetime.utcnow().timestamp())}.{ext}"
    filepath = os.path.join(upload_folder, filename)
    
    file.save(filepath)
    
    user.profile_image = f"/static/uploads/{filename}"
    db.session.commit()
    
    return jsonify({"profile_image": user.profile_image})

# --------------------------------

# --- Database Initialization (Lazy) ---
@app.before_request
def initialize_database():
    if not getattr(app, "_db_initialized", False):
        try:
            db.create_all()
            ensure_user_columns()
            ensure_expense_columns()
            app._db_initialized = True
        except Exception as e:
            app.logger.error(f"Database Init Error: {e}")


if __name__ == "__main__":
    app.run(debug=True)



