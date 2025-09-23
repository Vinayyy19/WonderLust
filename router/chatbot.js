const express = require('express');
const router = express.Router();
const Listing = require('../model/listing');
const faqs = require('../init/faq.json');

function getStaticIntentAndEntities(userMessage) {

    const lowerCaseMessage = userMessage.toLowerCase();
    let intent = "unknown_intent";
    let entities = {};

    // --- Intent: Greeting ---
    const greetingKeywords = ["hello", "hi", "hey", "hola", "namaste"];
    if (greetingKeywords.some(keyword => lowerCaseMessage.includes(keyword))) {
        intent = "greeting";
        return { intent, entities };
    }

    // --- Intent: Hotel Details General ---
    const hotelDetailsGeneralKeywords = ["tell me about your hotels", "what kind of properties", "about your listings", "general information", "your services"];
    if (hotelDetailsGeneralKeywords.some(keyword => lowerCaseMessage.includes(keyword))) {
        intent = "hotel_details_general";
        return { intent, entities };
    }

    // --- Intent: What do you offer / Types of Rooms ---
    const whatDoYouOfferKeywords = ["what do you offer", "types of rooms", "what services", "room types", "available types"];
    if (whatDoYouOfferKeywords.some(keyword => lowerCaseMessage.includes(keyword))) {
        intent = "what_do_you_offer";
        return { intent, entities };
    }

    // --- Intent: Check Availability ---
    const checkAvailabilityKeywords = ["check availability", "is it available", "book a room", "looking for a room", "reservations"];
    if (checkAvailabilityKeywords.some(keyword => lowerCaseMessage.includes(keyword))) {
        intent = "check_availability";
        return { intent, entities };
    }

    const name = ["what's ur name", "what's ur name ?", "name","develop", "developed", "what is your name"];
    if (name.some(keyword => lowerCaseMessage.includes(keyword))) {
        intent = "name";
        return { intent, entities };
    }


    // --- Intent: FAQ Query ---
    const faqKeywordsMap = {
        "wifi": ["wi-fi", "internet", "wireless","wifi","Wifi"],
        "check-in": ["check-in", "check in time", "arrival time"],
        "check-out": ["check-out", "check out time", "departure time"],
        "breakfast": ["breakfast", "food", "meal"],
        "pool": ["pool", "swimming"],
        "gym": ["gym", "fitness center"],
        "parking": ["parking", "car park"],
        "pets": ["pets", "animals"]
    };

    for (const topic in faqKeywordsMap) {
        if (faqKeywordsMap[topic].some(keyword => lowerCaseMessage.includes(keyword))) {
            intent = "faq_query";
            entities.faq_topic = topic; 
            return { intent, entities };
        }
    }

    return { intent, entities }; 
}


async function getChatbotResponse(userMessage) {
    const listingTitles = await Listing.distinct('title');
    let intent = "unknown_intent";
    let entities = {};

    for (const title of listingTitles) {
        if (userMessage.toLowerCase().includes(title.toLowerCase())) {
            entities.listing_title = title;
            if (userMessage.toLowerCase().includes("price") || userMessage.toLowerCase().includes("cost")) {
                intent = "get_price";
            } else {
                intent = "hotel_details_specific";
            }
            break;
        }
    }

    // If no listing intent found, use static intent detection
    if (intent === "unknown_intent") {
        const intentData = getStaticIntentAndEntities(userMessage);
        intent = intentData.intent;
        entities = { ...entities, ...intentData.entities };
    }

    switch (intent) {
        case "greeting":
            return "Hello! Welcome to Stazy. How can I assist you today? You can ask me about 'available rooms', 'prices', 'locations', or specific 'listing details'.";

        case "hotel_details_general":
            try {
                const listings = await Listing.find({}).limit(3); 
                if (listings.length > 0) {
                    const sampleTitles = listings.map(l => l.title).join(', ');
                    return `We offer various types of properties including ${sampleTitles}. Could you tell me which specific listing you're interested in, or are you looking for listings in a particular 'location' or 'price range'?`;
                } else {
                    return "We don't have any listings available at the moment. Please check back later!";
                }
            } catch (error) {
                console.error("Error fetching general listing overview:", error);
                return "I'm having trouble providing a general overview right now. Please try again later.";
            }

        case "hotel_details_specific":
        case "get_price":
            const requestedTitle = entities.listing_title;
            if (requestedTitle) {
                try {
                    const listing = await Listing.findOne({ title: { $regex: new RegExp(requestedTitle, 'i') } });
                    if (listing) {
                        if (intent === "get_price") {
                            return `The '${listing.title}' is priced at INR ${listing.price} per night. Prices may vary based on season and specific booking details.`;
                        } else {
                            return `Here are the details for '${listing.title}': It's located in ${listing.location}, ${listing.country}. Description: ${listing.description} The price is INR ${listing.price} per night.`;
                        }
                    } else {
                        return `I couldn't find details for a listing named '${requestedTitle}'. Can you please check the name or ask about general options?`;
                    }
                } catch (error) {
                    console.error("Error fetching specific listing details/price:", error);
                    return "I'm having trouble fetching specific listing details/price right now. Please try again later.";
                }
            } else {
                return "Which listing or room type are you interested in knowing the details/price for?";
            }

        case "find_by_location":
            const requestedLocation = entities.location;
            if (requestedLocation) {
                try {
                    const listings = await Listing.find({
                        location: { $regex: new RegExp(requestedLocation, 'i') }
                    }).limit(3);
                    if (listings.length > 0) {
                        const listingTitles = listings.map(l => l.title).join(', ');
                        return `We have listings in ${requestedLocation} including: ${listingTitles}. You can visit our website to see more options in this area.`;
                    } else {
                        return `I couldn't find any listings in '${requestedLocation}'. Please check the spelling or try a different area.`;
                    }
                } catch (error) {
                    console.error("Error fetching listings by location:", error);
                    return "I'm having trouble searching for listings by location right now. Please try again later.";
                }
            } else {
                return "Which location are you interested in?";
            }

        case "check_availability":
            try {
                const listings = await Listing.find({}).limit(5);
                if (listings.length > 0) {
                    const listingTitles = listings.map(l => l.title).join(', ');
                    return `We have various listings available, such as: ${listingTitles}. To find specific availability, please tell me your desired dates and preferred room type.`;
                } else {
                    return "I'm sorry, I couldn't find any listings currently. Please try again later or contact our support.";
                }
            } catch (error) {
                console.error("Error checking general availability:", error);
                return "I'm having trouble checking availability right now. Please try again later.";
            }

        case "faq_query":
            const faqTopic = entities.faq_topic;
            if (faqTopic) {
                const relevantFaq = faqs.find(faq =>
                    faq.questionKeywords.some(keyword =>
                        faqTopic.includes(keyword) || keyword.includes(faqTopic)
                    )
                );
                if (relevantFaq) {
                    return relevantFaq.answer;
                }
            }
            return "I can help with questions about Wi-Fi, check-in/out times, breakfast, and amenities. What specific FAQ are you interested in?";

        case "what_do_you_offer":
            try {
                const distinctTitles = await Listing.distinct('title');
                if (distinctTitles.length > 0) {
                    return `We offer various types of listings, such as: ${distinctTitles.join(', ')}. Is there a specific type you are looking for?`;
                } else {
                    return "I'm sorry, I don't have information about listing types right now. Please ensure there are listings in the database.";
                }
            } catch (error) {
                console.error("Error fetching distinct listing types:", error);
                return "I'm having trouble retrieving the types of properties we offer. Please try again later.";
            }
        case "name":
            return "I'm Stazy Chatbot made to assist you during your hotel booking journey.";

        case "unknown_intent":
        default:
            return "I'm sorry, I don't understand your question. I can help with inquiries about 'available rooms', 'prices', 'locations', or general hotel information like 'Wi-Fi' and 'check-in time'.";
    }
}

// Your existing POST route remains the same
router.post('/message', async (req, res) => {
    const userMessage = req.body.message;
    if (!userMessage) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    const botResponse = await getChatbotResponse(userMessage);
    res.json({ response: botResponse });
});

module.exports = router;