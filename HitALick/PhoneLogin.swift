






import SwiftUI
import FirebaseAuth
import FirebaseFirestore

struct CountryCode: Identifiable, Hashable {
    var id: String { "\(name)-\(code)" }
    let name: String
    let code: String
}

struct PhoneLogin: View {
    @AppStorage("isUserLoggedIn") var isUserLoggedIn: Bool = false
    @State private var selectedCountry = CountryCode(name: "United States", code: "+1")
    @State private var phoneNumber = ""
    @State private var smsCode = ""
    @State private var verificationID = ""
    @State private var isCodeSent = false
    @State private var isLoading = false
    @State private var showAlert = false
    @State private var alertMessage = ""

    let countries: [CountryCode] = [
        CountryCode(name: "United States", code: "+1"),
        CountryCode(name: "Canada", code: "+1"),
        CountryCode(name: "United Kingdom", code: "+44"),
        CountryCode(name: "India", code: "+91"),
        CountryCode(name: "Australia", code: "+61"),
        CountryCode(name: "Nigeria", code: "+234"),
        CountryCode(name: "South Africa", code: "+27"),
        CountryCode(name: "Mexico", code: "+52")
    ]

    var body: some View {
        if isUserLoggedIn {
            HomeScreen()
        } else {
            VStack(spacing: 20) {
                Text("Login with Phone")
                    .font(.title)

                Picker("Country", selection: $selectedCountry) {
                    ForEach(countries) { country in
                        Text("\(country.name) (\(country.code))").tag(country)
                    }
                }
                .pickerStyle(.menu)

                TextField("Phone Number", text: $phoneNumber)
                    .keyboardType(.phonePad)
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(8)

                if isCodeSent {
                    TextField("Enter SMS Code", text: $smsCode)
                        .keyboardType(.numberPad)
                        .padding()
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(8)

                    Button("Confirm Code") {
                        confirmCode()
                    }
                    .padding()
                    .background(Color.green)
                    .foregroundColor(.white)
                    .cornerRadius(8)
                } else {
                    Button("Send Code") {
                        sendVerificationCode()
                    }
                    .padding()
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(8)
                }

                if isLoading {
                    ProgressView("Processing...")
                }

                Text(alertMessage)
                    .foregroundColor(.red)
            }
            .padding()
            .alert(isPresented: $showAlert) {
                Alert(title: Text("Notice"), message: Text(alertMessage), dismissButton: .default(Text("OK")))
            }
        }
    }

    func sendVerificationCode() {
        let fullPhone = selectedCountry.code + phoneNumber
        isLoading = true
        PhoneAuthProvider.provider().verifyPhoneNumber(fullPhone, uiDelegate: nil) { id, error in
            isLoading = false
            if let error = error {
                alertMessage = error.localizedDescription
                showAlert = true
                return
            }
            verificationID = id ?? ""
            isCodeSent = true
        }
    }

    func confirmCode() {
        isLoading = true
        let credential = PhoneAuthProvider.provider().credential(withVerificationID: verificationID, verificationCode: smsCode)
        Auth.auth().signIn(with: credential) { result, error in
            isLoading = false
            if let error = error {
                alertMessage = error.localizedDescription
                showAlert = true
                return
            }

            guard let user = result?.user else {
                alertMessage = "User not found"
                showAlert = true
                return
            }

            checkIfUserExistsOrCreate(user: user)
        }
    }

    func checkIfUserExistsOrCreate(user: User) {
        let db = Firestore.firestore()
        let userRef = db.collection("users").document(user.uid)

        userRef.getDocument { snapshot, error in
            if let error = error {
                alertMessage = "Firestore error: \(error.localizedDescription)"
                showAlert = true
                return
            }

            if let data = snapshot?.data(), !data.isEmpty {
                // Existing user
                isUserLoggedIn = true
            } else {
                // New user, assign random name and username
                let randomName = "User" + UUID().uuidString.prefix(6)
                let randomUsername = generateUniqueUsername(prefix: "user")

                db.collection("users").whereField("username", isEqualTo: randomUsername).getDocuments { query, _ in
                    if let existing = query?.documents, !existing.isEmpty {
                        alertMessage = "Username already exists. Try again."
                        showAlert = true
                        return
                    }

                    userRef.setData([
                        "uid": user.uid,
                        "phoneNumber": user.phoneNumber ?? "",
                        "name": randomName,
                        "username": randomUsername,
                        "provider": "phone",
                        "createdAt": FieldValue.serverTimestamp()
                    ]) { err in
                        if let err = err {
                            alertMessage = "Error saving user: \(err.localizedDescription)"
                            showAlert = true
                        } else {
                            isUserLoggedIn = true
                        }
                    }
                }
            }
        }
    }

    func generateUniqueUsername(prefix: String) -> String {
        let randomSuffix = Int.random(in: 1000...9999)
        return "\(prefix)\(randomSuffix)"
    }
}
