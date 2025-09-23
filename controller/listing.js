const ExpressError = require("../Extra/ExpressError.js");
const listings = require("../model/listing");
const Booking = require("../model/booking");
const dayjs  = require("dayjs");
const mbxGeocoding = require('@mapbox/mapbox-sdk/services/geocoding');
const Razorpay = require("razorpay");
const crypto = require("crypto");

const mapToken = process.env.map_acess;
const GeocodingClient = mbxGeocoding({ accessToken: mapToken });

const razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,    
    key_secret: process.env.RAZORPAY_KEY_SECRET
});


module.exports.newListingSave = async(req,res)=>{
  const { title, description, image, price, location, country } = req.body;
  const url = req.file.path;
  const fileName = req.file.filename;

  const response = await GeocodingClient.forwardGeocode({
    query: location,
    limit: 1
  }).send();

  const newData = new listings({
    title,
    description,
    price,
    location,
    country,
    owner: req.user._id,
    image: { url, fileName },
    geometry: response.body.features[0].geometry
  });

  await newData.save();
  req.flash("success","New Listing Added");
  res.redirect("/");
};

module.exports.editRoute = async(req,res)=>{
  const { id } = req.params;    
  const listing = await listings.findById(id);
  if(!listing){
    req.flash("failed","Listing You Trying To find Didn't Exist");
    return res.redirect("/");
  }
  const ogimg = listing.image.url;
  const chngimg = ogimg.replace("/upload","/upload/w_250");
  res.render("listing/edit.ejs",{listing,chngimg});
};

module.exports.HomeRoute = async (req, res) => {
  const alllisting = await listings.find({});
  const thankyou = req.query.thankyou || null;
  res.render("listing/show.ejs", { alllisting, thankyou });
};


module.exports.ShowListingRoute = async (req,res)=>{
  const { id } = req.params;
  const listing = await listings.findById(id)
    .populate({path:"review",populate:{path:"author"}})
    .populate("owner");
  if(!listing){
    req.flash("failed","Listing You Trying To find Didn't Exist");
    return res.redirect("/");
  }
  res.render("listing/showlisting.ejs",{listing});
};

module.exports.destroyListing = async(req,res)=>{
  const { id } = req.params;
  const listing = await listings.findById(id);
  if (!listing.owner.equals(res.locals.CurrUser._id)){
    req.flash("failed","Only Listing Owner Can delete the post");
    return res.redirect(`/show/listing/${id}`);
  }
  await listings.findByIdAndDelete(id);
  req.flash("success","Listing Deleted");
  res.redirect("/");
};

exports.searchListings = async (req, res) => {
  try {
    const term     = req.query.q?.trim() || "";
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
    const location = req.query.location?.trim() || "";

    const query = {};
    if (term) query.title = new RegExp(term, "i");
    if (location) query.location = new RegExp(location, "i");
    if (minPrice !== null || maxPrice !== null) {
      query.price = {};
      if (minPrice !== null) query.price.$gte = minPrice;
      if (maxPrice !== null) query.price.$lte = maxPrice;
    }

    const alllisting = await listings.find(query);
    res.render("listing/show.ejs", { alllisting });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
};

module.exports.EditSaving =  async (req, res) => {
  const { id } = req.params;
  const { title, description, image, price, location, country } = req.body;

  const listing = await listings.findById(id);
  if (!listing.owner.equals(res.locals.CurrUser._id)){
    req.flash("failed","Only Listing Owner Can edit the post");
    return res.redirect(`/show/listing/${id}`);
  }

  const updateObject = { title, description, image, price, location, country };
  const updatedListing = await listings.findByIdAndUpdate(id, updateObject, { new: true });

  if(typeof req.file !== "undefined"){
    const url = req.file.path;
    const fileName = req.file.filename;
    updatedListing.image = {url,fileName};
    await updatedListing.save();
  }

  req.flash("success","Listing updated");  
  res.redirect(`/show/listing/${id}`);
};

module.exports.renderBookingPage = async (req, res) => {
  const { id } = req.params;
  const listing = await listings.findById(id);
  if (!listing) {
    req.flash("failed", "Listing not found");
    return res.redirect("/");
  }
  res.render("listing/book.ejs", { listing, availability: null });
};


exports.createPayment = async (req, res) => {
  const { id } = req.params;
  const { checkIn, checkOut, guests } = req.body;

  const listing = await listings.findById(id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });

  const today = dayjs().startOf("day");
  const checkInDate = dayjs(checkIn);
  const checkOutDate = dayjs(checkOut);

  if (checkInDate.isBefore(today))
    return res.status(400).json({ error: "Check-in cannot be before today" });
  if (checkOutDate.isBefore(today.add(1, "day")))
    return res.status(400).json({ error: "Check-out must be at least 1 day from today" });

  const nights = checkOutDate.diff(checkInDate, "day");
  if (nights <= 0)
    return res.status(400).json({ error: "Invalid dates" });

  const totalPrice = listing.price * nights;

  try {
    const order = await razorpayInstance.orders.create({
      amount: totalPrice * 100,
      currency: "INR",
      receipt: `receipt_${Date.now()}`
    });

    res.json({
      orderId: order.id,
      totalPrice,
      key_id: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Payment initialization failed" });
  }
};


exports.verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      listingId,
      checkIn,
      checkOut,
      guests
    } = req.body;

    if (
      !razorpay_payment_id ||
      !razorpay_order_id ||
      !razorpay_signature ||
      !listingId
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required payment details."
      });
    }

    // Signature verification
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Payment signature mismatch. Verification failed."
      });
    }

    // Create booking
    const listing = await listings.findById(listingId);
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: "Listing not found for booking."
      });
    }

    const nights = dayjs(checkOut).diff(dayjs(checkIn), "day");
    if (nights <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid stay duration."
      });
    }

    const totalPrice = listing.price * nights;

    const booking = new Booking({
      listing: listingId,
      user: req.user._id,
      checkIn,
      checkOut,
      guests,
      totalPrice,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id
    });

    await booking.save();

    return res.json({
      success: true,
      message: "Payment verified and booking confirmed!",
      receipt: {
        bookingId: booking._id,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        amountPaid: totalPrice,
        currency: "INR",
        listingTitle: listing.title,
        checkIn,
        checkOut,
        guests
      },
      redirectUrl: '/', 
      thankyouMsg: `✅ Booking confirmed! Receipt ID: ${booking._id}`
    });

  } catch (err) {
    console.error("Payment verification error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during payment verification."
    });
  }
};
