create table users(
	user_id serial primary key,
	user_email varchar(100) unique not null,
	user_password varchar(100) not null,
	user_type varchar(10) not null check (user_type in ('employer', 'seeker'))
)


create table user_refresh_tokens (
    refresh_id serial primary key,
    refresh_user_email varchar(255) not null,
    refresh_token text not null,
	refresh_token_expires_at timestamptz not null,
	foreign key (refresh_user_email) references users(user_email) on delete cascade
);

create table user_details(
	details_id serial primary key,
	details_user_id int unique not null,
	details_user_full_name varchar(100) not null,
	details_company_name varchar(50),
	foreign key (details_user_id) references users(user_id) on delete cascade
)

create table seeker_profile_details(
	seeker_id serial primary key,
	seeker_user_id int unique not null,
	seeker_phone_number VARCHAR(15) NOT NULL CHECK (seeker_phone_number ~ '^[0-9]+$'),
	seeker_city VARCHAR(100) NOT NULL,
	seeker_state VARCHAR(100) NOT NULL,
	seeker_country VARCHAR(100) NOT NULL,
	seeker_bio TEXT,
	seeker_skills JSONB DEFAULT '[]'::jsonb, 
	seeker_work_experience JSONB DEFAULT '[]'::jsonb,
	seeker_education JSONB DEFAULT '[]'::jsonb NOT NULL,
	seeker_resume_link VARCHAR(2048),
	seeker_profile_image_link VARCHAR(2048),
	foreign key (seeker_user_id) references users(user_id) on delete cascade
)

create table employer_profile_details(
	employer_id serial primary key,
	employer_user_id int unique not null,
	employer_company_name VARCHAR(150) NOT NULL,
	employer_industry VARCHAR(100),
	employer_company_size VARCHAR(50),
	employer_company_logo_link VARCHAR(2048),
	employer_website_link VARCHAR(2048),
	employer_contact_email VARCHAR(255) NOT NULL,
	employer_phone_number VARCHAR(15) NOT NULL CHECK (employer_phone_number ~ '^[0-9]+$'),
	employer_city VARCHAR(100),
    employer_state VARCHAR(100),
    employer_country VARCHAR(100),
	employer_description TEXT,
	foreign key (employer_user_id) references users(user_id) on delete cascade
)